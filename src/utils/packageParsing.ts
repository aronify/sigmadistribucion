/**
 * Utility functions for parsing and formatting package contents
 */

export interface ParsedContents {
  recipientName: string
  recipientCompany: string
  deliveryAddress: string
  contents: string
}

/**
 * Parse contents_note string into structured data
 */
export const parseContentsNote = (contentsNote: string): ParsedContents => {
  const lines = contentsNote.split('\n').filter(l => l.trim())
  let recipientName = ''
  let recipientCompany = ''
  let deliveryAddress = ''
  let contents = ''

  for (const line of lines) {
    if (line.startsWith('To: ')) {
      const toLine = line.substring(4).trim()
      // Parse "Name Surname | Company" or "Name Surname (Company)"
      const pipeMatch = toLine.match(/^(.+?)\s*\|\s*(.+)$/)
      const parenMatch = toLine.match(/^(.+?)\s+\((.+)\)\s*$/)
      
      if (pipeMatch) {
        const namePart = pipeMatch[1].trim()
        const nameParts = namePart.split(/\s+/)
        recipientName = nameParts[0] || ''
        if (nameParts.length > 1) {
          recipientName += ' ' + nameParts.slice(1).join(' ')
        }
        recipientCompany = pipeMatch[2].trim()
      } else if (parenMatch) {
        const namePart = parenMatch[1].trim()
        const nameParts = namePart.split(/\s+/)
        recipientName = nameParts[0] || ''
        if (nameParts.length > 1) {
          recipientName += ' ' + nameParts.slice(1).join(' ')
        }
        recipientCompany = parenMatch[2].trim()
      } else {
        recipientName = toLine
      }
    } else if (line.startsWith('Items: ')) {
      contents = line.substring(7).trim()
    } else if (line.trim() && !line.startsWith('To: ') && !line.startsWith('Items: ')) {
      // This is likely the address line
      if (!deliveryAddress) {
        deliveryAddress = line.trim()
      } else {
        deliveryAddress += '\n' + line.trim()
      }
    }
  }

  return { recipientName, recipientCompany, deliveryAddress, contents }
}

/**
 * Format structured data back into contents_note string
 */
export const formatContentsNote = (
  recipientName: string,
  recipientCompany: string,
  deliveryAddress: string,
  contents: string
): string => {
  const parts: string[] = []
  
  if (recipientName || recipientCompany) {
    let toLine = 'To: '
    if (recipientName) {
      toLine += recipientName.trim()
    }
    if (recipientCompany) {
      toLine += ` | ${recipientCompany.trim()}`
    }
    parts.push(toLine)
  }
  
  if (deliveryAddress) {
    parts.push(deliveryAddress.trim())
  }
  
  if (contents) {
    parts.push(`Items: ${contents.trim()}`)
  }
  
  return parts.join('\n')
}

