// Tiny markdown renderer for blog posts (safe: everything is escaped first).
// Supports: ## / ### headings, paragraphs, - and 1. lists, > quotes, ![alt](src), [text](url),
// **bold**, *italic*, `code`, --- rules, and a YouTube link on its own line becomes an embed.
window.renderMarkdown = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^(https?:\/\/|\/|#|mailto:)/i.test(u) ? u : '#');

  function inline(s) {
    return esc(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${safeUrl(src)}" alt="${alt}" loading="lazy">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
        const ext = /^https?:/i.test(href);
        return `<a href="${safeUrl(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  function youtube(line) {
    const m = line.trim().match(/^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})\S*$/);
    return m ? `<div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" title="YouTube" loading="lazy" allowfullscreen></iframe></div>` : '';
  }

  return function render(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    const out = [];
    let para = [];
    let listType = null;
    let items = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    const flushList = () => { if (listType) { out.push(`<${listType}>${items.map((i) => `<li>${inline(i)}</li>`).join('')}</${listType}>`); listType = null; items = []; } };

    for (const raw of lines) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if (youtube(line)) { flushPara(); flushList(); out.push(youtube(line)); continue; }
      if ((m = line.match(/^(#{2,4})\s+(.*)$/))) { flushPara(); flushList(); const n = m[1].length; out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
      if (/^---+$/.test(line.trim())) { flushPara(); flushList(); out.push('<hr>'); continue; }
      if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
      if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flushPara(); if (listType !== 'ul') { flushList(); listType = 'ul'; } items.push(m[1]); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (listType !== 'ol') { flushList(); listType = 'ol'; } items.push(m[1]); continue; }
      if ((m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) {
        flushPara(); flushList();
        out.push(`<figure><img src="${safeUrl(m[2])}" alt="${esc(m[1])}" loading="lazy">${m[1] ? `<figcaption>${esc(m[1])}</figcaption>` : ''}</figure>`);
        continue;
      }
      flushList();
      para.push(line.trim());
    }
    flushPara(); flushList();
    return out.join('\n');
  };
})();
