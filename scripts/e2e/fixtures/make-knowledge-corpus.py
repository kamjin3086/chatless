"""Create the four-format semantic fixture in an explicit, retained directory.
Usage: python3 scripts/e2e/fixtures/make-knowledge-corpus.py /outside/repo/corpus
Existing fixtures are not overwritten. No additional Python packages are used.
"""
from pathlib import Path
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from xml.sax.saxutils import escape

def write_part(archive, name, data):
 info=ZipInfo(name, (1980,1,1,0,0,0));info.compress_type=ZIP_DEFLATED
 archive.writestr(info, data)

if len(sys.argv) != 2:
 raise SystemExit(__doc__)
ROOT=Path(sys.argv[1]);ROOT.mkdir(parents=True,exist_ok=True)
expected=['orion-maintenance.txt','mira-filter.md','lyra-backup.docx','aster-inspection.pdf']
if any((ROOT/name).exists() for name in expected):
 if not all((ROOT/name).exists() for name in expected):
  raise SystemExit('Partial corpus exists; preserve it and choose a new directory.')
 print(f'Reusing retained corpus: {ROOT}')
 raise SystemExit(0)
text='ORION-KB-4826 设备维护记录\n维护周期为37天，负责人是林工，授权口令为紫杉星河4826。\n'+('\n记录背景：这份维护手册保留完整的原文、Unicode 表情🪐和分段，用于核对真实分词器下的无损分块。不得将背景描述误作额外的维护要求。'*65)+'\n最终复核：ORION-KB-4826 仍为37天、林工、紫杉星河4826。\n'
(ROOT/'orion-maintenance.txt').write_text(text,encoding='utf-8')
(ROOT/'mira-filter.md').write_text('# MIRA-KB-9318 过滤器维护手册\n\n## 更换政策\n\n过滤器每隔19天更换一次，负责人陈工，核验短语是银杏回声9318。\n\n## 约束\n\n这份文档没有说明采购预算，也没有提供临时联系方式。\n',encoding='utf-8')
paragraphs=['LYRA-DOCX-5842 操作规程','备份留存周期为61天，负责人赵工，恢复核验短语为松石航线5842。','系统每周执行完整性验证。本文未提供供应商电话。']
xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+''.join('<w:p><w:r><w:t>'+escape(p)+'</w:t></w:r></w:p>' for p in paragraphs)+'<w:sectPr/></w:body></w:document>'
with ZipFile(ROOT/'lyra-backup.docx','w',ZIP_DEFLATED) as z:
 write_part(z,'[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 write_part(z,'_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 write_part(z,'word/document.xml',xml)
lines=['ASTER-PDF-7261 emergency inspection manual','Inspection interval: 43 days.','Responsible engineer: Morgan.','Authorization phrase: amberharbor7261.','This manual does not specify a purchase budget.']
content='BT /F1 12 Tf 72 760 Td 18 TL '+(' T* '.join('('+s+') Tj' for s in lines))+' ET'
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',f'<< /Length {len(content)} >>\nstream\n{content}\nendstream'.encode()]
pdf=b'%PDF-1.4\n'; offsets=[0]
for i,obj in enumerate(objects,1):
 offsets.append(len(pdf));pdf+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
xref=len(pdf);pdf+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()+b''.join(f'{n:010d} 00000 n \n'.encode() for n in offsets[1:])+f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
(ROOT/'aster-inspection.pdf').write_bytes(pdf)
print(ROOT)
