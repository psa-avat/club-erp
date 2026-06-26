import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface PdfTableOptions {
  title: string
  subtitle?: string
  head: string[][]
  body: (string | number)[][]
  filename: string
  orientation?: 'portrait' | 'landscape'
}

export function exportTableToPdf({
  title,
  subtitle,
  head,
  body,
  filename,
  orientation = 'portrait',
}: PdfTableOptions): void {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })

  const pageW = doc.internal.pageSize.getWidth()

  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(title, pageW / 2, 15, { align: 'center' })

  if (subtitle) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100)
    doc.text(subtitle, pageW / 2, 21, { align: 'center' })
    doc.setTextColor(0)
  }

  autoTable(doc, {
    head,
    body,
    startY: subtitle ? 26 : 22,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didDrawPage: (data) => {
      const pageCount = (doc as jsPDF & { internal: { getNumberOfPages(): number } }).internal.getNumberOfPages()
      doc.setFontSize(7)
      doc.setTextColor(150)
      doc.text(
        `Page ${data.pageNumber}/${pageCount}`,
        pageW - 10,
        doc.internal.pageSize.getHeight() - 5,
        { align: 'right' },
      )
      doc.setTextColor(0)
    },
  })

  doc.save(filename)
}
