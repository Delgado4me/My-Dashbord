/* Local PDF export of a fully loaded email. No content leaves the browser. */
(function (root) {
  'use strict';
  const base64 = bytes => {
    let result = '';
    for (let offset = 0; offset < bytes.length; offset += 16384)
      result += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    return btoa(result);
  };
  function filename(subject) {
    return (String(subject || 'Лист').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70) || 'Лист') + '.pdf';
  }
  function create(letter, JsPDF, fontBytes) {
    if (!letter || !letter.available || typeof letter.body !== 'string') throw new Error('Спочатку завантажте повний текст листа.');
    const doc = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
    doc.addFileToVFS('DejaVuSans.ttf', base64(fontBytes));
    doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
    doc.setFont('DejaVuSans', 'normal');
    const left = 17, right = 17, top = 20, bottom = 19, width = 210 - left - right;
    let y = top;
    function write(value, size, lineHeight, color = '#1c2640') {
      doc.setFontSize(size); doc.setTextColor(color);
      const lines = String(value || ' ').replace(/\r\n?/g, '\n').split('\n');
      for (const line of lines) {
        const wrapped = doc.splitTextToSize(line || ' ', width);
        for (const part of wrapped) {
          if (y + lineHeight > 297 - bottom) { doc.addPage(); y = top }
          doc.text(part, left, y); y += lineHeight;
        }
      }
    }
    write(letter.subject || 'Лист', 16, 8);
    y += 3;
    if (letter.from) write('Від: ' + letter.from, 10, 5.5, '#59657a');
    if (letter.to) write('Кому: ' + letter.to, 10, 5.5, '#59657a');
    if (letter.date) write('Дата: ' + letter.date, 10, 5.5, '#59657a');
    y += 4;
    doc.setDrawColor('#d9dfed'); doc.line(left, y, 210 - right, y); y += 9;
    write(letter.body, 10.5, 6);
    if (letter.attachments?.length) {
      y += 7;
      write('Вкладення не входять у цей PDF. Відкрийте оригінал листа в Gmail.', 9, 5.5, '#59657a');
      write('Вкладення: ' + letter.attachments.map(item => item.name).join(', '), 9, 5.5, '#59657a');
    }
    const count = doc.getNumberOfPages();
    for (let page = 1; page <= count; page++) {
      doc.setPage(page); doc.setFontSize(8); doc.setTextColor('#7e8aa0');
      doc.text(page + ' / ' + count, 210 - right, 286, { align: 'right' });
    }
    return { bytes: doc.output('arraybuffer'), name: filename(letter.subject), pages: count };
  }
  root.dashboardMailPdf = { create, filename };
})(typeof window === 'undefined' ? globalThis : window);
