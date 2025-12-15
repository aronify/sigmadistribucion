describe('Sigma Ship - Core Flows', () => {
  beforeEach(() => {
    // Reset database state before each test
    cy.task('resetDatabase')
  })

  describe('Authentication Flow', () => {
    it('should login with admin PIN and show admin interface', () => {
      cy.loginAsAdmin()
      
      // Should see admin-specific features
      cy.get('[data-testid="settings-card"]').should('be.visible')
      cy.get('[data-testid="user-role"]').should('contain', 'admin')
    })

    it('should login with standard user PIN and hide admin features', () => {
      cy.loginAsStandard()
      
      // Should not see admin features
      cy.get('[data-testid="settings-card"]').should('not.exist')
      cy.get('[data-testid="user-role"]').should('contain', 'standard')
    })

    it('should logout after completing an action', () => {
      cy.loginAsStandard()
      
      // Create a package (should auto-logout after printing)
      cy.get('[data-testid="create-label-card"]').click()
      cy.get('[data-testid="branch-button"]').first().click()
      cy.get('[data-testid="next-button"]').click()
      cy.get('[data-testid="contents-textarea"]').type('Test logout flow')
      cy.get('[data-testid="next-button"]').click()
      cy.get('[data-testid="material-button"]').first().click()
      cy.get('[data-testid="create-package-button"]').click()
      
      // Print label (triggers auto-logout)
      cy.get('[data-testid="print-label-button"]').click()
      
      // Should be back at login screen
      cy.get('[data-testid="pin-login"]').should('be.visible')
    })
  })

  describe('Package Creation Flow', () => {
    it('should create package and print label successfully', () => {
      cy.loginAsStandard()
      
      // Create package
      cy.get('[data-testid="create-label-card"]').click()
      
      // Step 1: Select destination
      cy.get('[data-testid="branch-button"]').first().click()
      cy.get('[data-testid="next-button"]').click()
      
      // Step 2: Enter contents
      cy.get('[data-testid="contents-textarea"]').type('Electronics shipment')
      cy.get('[data-testid="next-button"]').click()
      
      // Step 3: Select material
      cy.get('[data-testid="material-button"]').first().click()
      cy.get('[data-testid="create-package-button"]').click()
      
      // Verify package created
      cy.get('[data-testid="package-id"]').should('be.visible')
      cy.get('[data-testid="package-status"]').should('contain', 'Created')
      
      // Print label
      cy.get('[data-testid="print-label-button"]').click()
      
      // Should show success message
      cy.get('[data-testid="success-toast"]').should('be.visible')
    })

    it('should deduct inventory when creating package', () => {
      cy.loginAsStandard()
      
      // Check initial inventory
      cy.get('[data-testid="inventory-card"]').click()
      cy.get('[data-testid="stock-count"]').first().then(($el) => {
        const initialStock = parseInt($el.text())
        
        // Go back and create package
        cy.get('[data-testid="home-card"]').click()
        cy.get('[data-testid="create-label-card"]').click()
        
        // Complete package creation
        cy.get('[data-testid="branch-button"]').first().click()
        cy.get('[data-testid="next-button"]').click()
        cy.get('[data-testid="contents-textarea"]').type('Test inventory deduction')
        cy.get('[data-testid="next-button"]').click()
        cy.get('[data-testid="material-button"]').first().click()
        cy.get('[data-testid="create-package-button"]').click()
        
        // Check inventory was deducted
        cy.get('[data-testid="inventory-card"]').click()
        cy.get('[data-testid="stock-count"]').first().should(($el) => {
          const newStock = parseInt($el.text())
          expect(newStock).to.equal(initialStock - 1)
        })
      })
    })
  })

  describe('Barcode Scanning Flow', () => {
    it('should scan package and show status update options', () => {
      cy.loginAsStandard()
      
      // Create a test package first
      cy.createTestPackage().then((packageId) => {
        // Scan the package
        cy.scanBarcode(packageId)
        
        // Should show package details and available actions
        cy.get('[data-testid="package-status-card"]').should('be.visible')
        cy.get('[data-testid="package-id-display"]').should('contain', packageId)
        cy.get('[data-testid="available-actions"]').should('be.visible')
      })
    })

    it('should update package status through scan', () => {
      cy.loginAsStandard()
      
      // Create and scan package
      cy.createTestPackage().then((packageId) => {
        cy.scanBarcode(packageId)
        
        // Update status to "Handed Over"
        cy.get('[data-testid="action-button"]').contains('Hand Over').click()
        
        // Should show success message
        cy.get('[data-testid="success-toast"]').should('be.visible')
        
        // Should auto-logout after status update
        cy.get('[data-testid="pin-login"]').should('be.visible')
      })
    })
  })

  describe('Package Management Flow', () => {
    it('should view package list and filter by status', () => {
      cy.loginAsStandard()
      
      // Go to packages view
      cy.get('[data-testid="packages-card"]').click()
      
      // Should see packages list
      cy.get('[data-testid="packages-list"]').should('be.visible')
      
      // Filter by status
      cy.get('[data-testid="status-filter"]').select('created')
      cy.get('[data-testid="packages-list"]').should('be.visible')
      
      // Search for specific package
      cy.get('[data-testid="search-input"]').type('ABC123')
      cy.get('[data-testid="package-item"]').should('contain', 'ABC123')
    })

    it('should view package details and status history', () => {
      cy.loginAsStandard()
      
      // Go to packages and select one
      cy.get('[data-testid="packages-card"]').click()
      cy.get('[data-testid="package-item"]').first().click()
      
      // Should show package details
      cy.get('[data-testid="package-detail"]').should('be.visible')
      cy.get('[data-testid="status-timeline"]').should('be.visible')
    })
  })

  describe('Admin Functions', () => {
    it('should allow admin to cancel packages', () => {
      cy.loginAsAdmin()
      
      // Create a package
      cy.createTestPackage().then((packageId) => {
        // Scan and cancel it
        cy.scanBarcode(packageId)
        cy.get('[data-testid="action-button"]').contains('Cancel').click()
        
        // Should show success message
        cy.get('[data-testid="success-toast"]').should('be.visible')
      })
    })

    it('should allow admin to manage label templates', () => {
      cy.loginAsAdmin()
      
      // Go to settings
      cy.get('[data-testid="settings-card"]').click()
      
      // Should see template management options
      cy.get('[data-testid="template-manager"]').should('be.visible')
    })

    it('should allow admin to manage users', () => {
      cy.loginAsAdmin()
      
      // Go to settings
      cy.get('[data-testid="settings-card"]').click()
      
      // Should see user management
      cy.get('[data-testid="user-management"]').should('be.visible')
      cy.get('[data-testid="add-user-button"]').should('be.visible')
    })
  })

  describe('Inventory Management', () => {
    it('should show low stock warnings', () => {
      cy.loginAsStandard()
      
      // Go to inventory
      cy.get('[data-testid="inventory-card"]').click()
      
      // Should show low stock items if any
      cy.get('[data-testid="low-stock-warning"]').should('be.visible')
    })

    it('should allow admin to adjust stock levels', () => {
      cy.loginAsAdmin()
      
      // Go to inventory
      cy.get('[data-testid="inventory-card"]').click()
      
      // Adjust stock for first item
      cy.get('[data-testid="adjust-stock-button"]').first().click()
      cy.get('[data-testid="adjustment-input"]').type('10')
      cy.get('[data-testid="adjustment-reason"]').type('Stock count')
      cy.get('[data-testid="apply-adjustment"]').click()
      
      // Should show success message
      cy.get('[data-testid="success-toast"]').should('be.visible')
    })
  })

  describe('Mobile Responsiveness', () => {
    it('should work on mobile viewport', () => {
      cy.viewport(375, 667) // iPhone SE
      cy.loginAsStandard()
      
      // Should show mobile navigation
      cy.get('[data-testid="mobile-nav"]').should('be.visible')
      
      // Should be able to navigate
      cy.get('[data-testid="mobile-nav-item"]').first().click()
    })
  })
})
