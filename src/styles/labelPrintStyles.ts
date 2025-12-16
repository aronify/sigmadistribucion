/**
 * Shared print styles for shipping labels
 * 58mm x 40mm thermal label format
 */

export const labelPrintStyles = `
  .print-label-container {
    position: absolute;
    left: -9999px;
    top: -9999px;
    width: 58mm;
    height: 40mm;
  }

  @media print {
    /* Force hide everything */
    * {
      margin: 0 !important;
      padding: 0 !important;
    }

    body * {
      visibility: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    #print-label,
    #print-label-packages-modal,
    #print-label *,
    #print-label-packages-modal * {
      visibility: visible !important;
    }

    #print-label,
    #print-label-packages-modal {
      position: fixed !important;
      left: 0 !important;
      top: 0 !important;
      width: 58mm !important;
      height: 40mm !important;
      max-width: 58mm !important;
      max-height: 40mm !important;
      background: white !important;
      display: block !important;
      margin: 0 !important;
      padding: 0 !important;
      z-index: 9999 !important;
      page-break-after: avoid !important;
      page-break-inside: avoid !important;
      page-break-before: avoid !important;
    }

    @page {
      size: 58mm 40mm;
      margin: 0 !important;
      padding: 0 !important;
    }

    html, body {
      width: 58mm !important;
      height: 40mm !important;
      max-width: 58mm !important;
      max-height: 40mm !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: white !important;
      page-break-after: avoid !important;
      page-break-before: avoid !important;
    }

    /* Main Label Container */
    .shipping-label {
      width: 58mm !important;
      height: 40mm !important;
      max-width: 58mm !important;
      max-height: 40mm !important;
      padding: 0.5mm !important;
      box-sizing: border-box !important;
      display: flex !important;
      flex-direction: column !important;
      margin: 0 !important;
      background: #ffffff !important;
      color: #000 !important;
      position: relative !important;
      border: 0.2mm solid #000000 !important;
      overflow: hidden !important;
      page-break-inside: avoid !important;
      page-break-after: avoid !important;
    }

    /* Left Section - Logo & Content */
    .label-left-section {
      display: flex !important;
      flex-direction: column !important;
      padding: 0 !important;
      margin: 0 !important;
      flex: 1 !important;
      min-width: 0 !important;
      height: 100% !important;
    }

    /* Logo Section - Simple Top Bar - ALWAYS VISIBLE */
    .logo-section {
      background: #000000 !important;
      padding: 0.8mm !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      height: 6mm !important;
      max-height: 6mm !important;
      min-height: 6mm !important;
      visibility: visible !important;
      opacity: 1 !important;
    }

    .logo {
      max-height: 5mm !important;
      max-width: 90% !important;
      width: auto !important;
      height: auto !important;
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      object-fit: contain !important;
      image-rendering: -webkit-optimize-contrast !important;
      image-rendering: crisp-edges !important;
      filter: brightness(0) invert(1) !important;
    }
    
    .logo[src=""],
    .logo:not([src]) {
      display: none !important;
    }

    .logo-separator {
      display: none !important;
    }

    /* Tracking Code Section */
    .tracking-code-section {
      padding: 0.5mm !important;
      background: #ffffff !important;
      border-bottom: 0.2mm solid #000000 !important;
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      justify-content: space-between !important;
      flex-shrink: 0 !important;
      gap: 0.5mm !important;
      min-height: 3mm !important;
    }

    .tracking-label {
      font-size: 1.5pt !important;
      font-weight: 700 !important;
      color: #000000 !important;
      text-transform: uppercase !important;
      font-family: 'Arial', sans-serif !important;
      margin: 0 !important;
      white-space: nowrap !important;
      line-height: 1.2 !important;
    }

    .tracking-code {
      font-size: 5pt !important;
      font-weight: 800 !important;
      letter-spacing: 0.8px !important;
      color: #000000 !important;
      line-height: 1.3 !important;
      text-transform: uppercase !important;
      font-family: 'Courier New', 'Monaco', monospace !important;
      padding: 0 !important;
      border: none !important;
      background: transparent !important;
      display: inline-block !important;
      flex: 1 !important;
      text-align: right !important;
    }

    /* Main Content Section - Recipient Info */
    .recipient-section {
      display: flex !important;
      flex-direction: column !important;
      padding: 1mm !important;
      gap: 0.5mm !important;
      flex: 1 !important;
      justify-content: flex-start !important;
      background: #ffffff !important;
      position: relative !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }

    /* Beneficiary Name - BIGGEST & BOLDEST */
    .recipient-name {
      font-weight: 800 !important;
      font-size: 10pt !important;
      margin: 0 !important;
      padding: 0 !important;
      color: #000000 !important;
      line-height: 1.3 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.3px !important;
      font-family: 'Arial', 'Helvetica', sans-serif !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      white-space: normal !important;
      flex-shrink: 0 !important;
    }

    /* Company Name - MEDIUM */
    .company-name {
      font-weight: 600 !important;
      font-size: 7pt !important;
      color: #000000 !important;
      line-height: 1.3 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.2px !important;
      font-family: 'Arial', 'Helvetica', sans-serif !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      white-space: normal !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .company-name::before {
      display: none !important;
    }

    /* Address - READABLE */
    .address-text {
      font-size: 5pt !important;
      color: #000000 !important;
      line-height: 1.3 !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      white-space: normal !important;
      font-weight: 400 !important;
      font-family: 'Arial', sans-serif !important;
      margin: 0 !important;
      padding: 0 !important;
      letter-spacing: 0.1px !important;
    }

    .address-text::before {
      display: none !important;
    }

    /* QR Code Section - BIG & READABLE */
    .label-right-section {
      position: absolute !important;
      right: 0.5mm !important;
      bottom: 0.5mm !important;
      width: 16mm !important;
      height: 16mm !important;
      max-width: 16mm !important;
      max-height: 16mm !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: #ffffff !important;
      border: 0.2mm solid #000000 !important;
      padding: 0.5mm !important;
      box-sizing: border-box !important;
    }

    /* QR Code - Clear and scannable */
    .qr-code {
      width: 100% !important;
      height: 100% !important;
      max-width: 100% !important;
      max-height: 100% !important;
      display: block !important;
      object-fit: contain !important;
      border: none !important;
      padding: 0 !important;
      background: transparent !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      image-rendering: -webkit-optimize-contrast !important;
      image-rendering: crisp-edges !important;
    }

    /* Items List - Very Compact */
    .items-list {
      font-size: 2.2pt !important;
      color: #000000 !important;
      line-height: 1.2 !important;
      font-family: 'Arial', 'Helvetica', sans-serif !important;
      font-weight: 400 !important;
    }

    .items-list div {
      margin-bottom: 0.05mm !important;
      line-height: 1.2 !important;
      padding: 0 !important;
    }
  }
`

