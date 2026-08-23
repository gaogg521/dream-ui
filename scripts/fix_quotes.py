import re

p = r'D:\aionui-m0\1oneUI\scripts\gen_doc_docx.py'
with open(p, 'r', encoding='utf-8') as f:
    c = f.read()

# 替换中文字符之间的双引号为「」
c = re.sub(r'(?<=[\u4e00-\u9fff])"(?=[\u4e00-\u9fff])', '「', c)
c = re.sub(r'(?<=[\u4e00-\u9fff])"(?=[，。、）：；！？\s])', '」', c)
c = re.sub(r'(?<=[A-Za-z0-9])"(?=[\u4e00-\u9fff])', '」', c)
c = re.sub(r'(?<=[（(，、：；])"(?=[\u4e00-\u9fffA-Za-z])', '「', c)

with open(p, 'w', encoding='utf-8') as f:
    f.write(c)

lines = c.split('\n')
print(lines[167][:100])
