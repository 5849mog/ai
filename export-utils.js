export function exportName(kind, extension, date=new Date()) {
  const p=n=>String(n).padStart(2,'0');
  return `wumu-${kind}-${date.getFullYear()}${p(date.getMonth()+1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.${extension}`;
}
export function downloadBlob(blob, name, doc=document) {
  const url=URL.createObjectURL(blob), link=doc.createElement('a');
  try { link.href=url;link.download=name;doc.body.append(link);link.click();link.remove(); }
  finally { setTimeout(()=>URL.revokeObjectURL(url),60000); }
}
export function downloadText(text, name, type='application/json') {
  downloadBlob(new Blob([text],{type:`${type};charset=utf-8`}),name);
}
