// Custom commands for Sigma Ship testing

Cypress.Commands.add('loginAsAdmin', () => {
  cy.visit('/')
  
  // Enter admin PIN
  cy.get('[data-testid="pin-button-1"]').click()
  cy.get('[data-testid="pin-button-2"]').click()
  cy.get('[data-testid="pin-button-3"]').click()
  cy.get('[data-testid="pin-button-4"]').click()
  cy.get('[data-testid="pin-button-5"]').click()
  cy.get('[data-testid="pin-button-6"]').click()
  
  cy.get('[data-testid="sign-in-button"]').click()
  
  // Wait for login to complete
  cy.url().should('not.include', '/login')
  cy.get('[data-testid="user-name"]').should('contain', 'Admin User')
})

Cypress.Commands.add('loginAsStandard', () => {
  cy.visit('/')
  
  // Enter standard user PIN
  cy.get('[data-testid="pin-button-1"]').click()
  cy.get('[data-testid="pin-button-1"]').click()
  cy.get('[data-testid="pin-button-1"]').click()
  cy.get('[data-testid="pin-button-1"]').click()
  cy.get('[data-testid="pin-button-1"]').click()
  cy.get('[data-testid="pin-button-1"]').click()
  
  cy.get('[data-testid="sign-in-button"]').click()
  
  // Wait for login to complete
  cy.url().should('not.include', '/login')
  cy.get('[data-testid="user-name"]').should('contain', 'John Smith')
})

Cypress.Commands.add('createTestPackage', () => {
  // Click Create Label
  cy.get('[data-testid="create-label-card"]').click()
  
  // Step 1: Select destination
  cy.get('[data-testid="branch-button"]').first().click()
  cy.get('[data-testid="next-button"]').click()
  
  // Step 2: Enter contents
  cy.get('[data-testid="contents-textarea"]').type('Test package contents')
  cy.get('[data-testid="next-button"]').click()
  
  // Step 3: Select material
  cy.get('[data-testid="material-button"]').first().click()
  cy.get('[data-testid="create-package-button"]').click()
  
  // Wait for package creation
  cy.get('[data-testid="package-id"]').should('be.visible')
  
  // Get the package ID
  return cy.get('[data-testid="package-id"]').invoke('text')
})

Cypress.Commands.add('scanBarcode', (packageId: string) => {
  // Click Scan & Update
  cy.get('[data-testid="scan-card"]').click()
  
  // Mock successful scan
  cy.window().then((win) => {
    const mockScanResult = {
      decodedText: JSON.stringify({ pkg: packageId, rev: 1 }),
      decodedResult: { format: 'CODE_128' }
    }
    
    // Trigger scan success event
    win.dispatchEvent(new CustomEvent('scanSuccess', { detail: mockScanResult }))
  })
  
  // Wait for package status card to appear
  cy.get('[data-testid="package-status-card"]').should('be.visible')
})
