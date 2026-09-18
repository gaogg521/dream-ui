import pathlib
import re

p = str(pathlib.Path(__file__).resolve().with_name('gen_doc_docx.py'))
with open(p, 'r', encoding='utf-8') as f:
    c = f.read()

# 按长度从长到短替换
replacements = [
    ("1ONE Work 智能协作平台软件", "One Work 智能协作平台软件"),
    ("1ONE_Work_软件设计说明书", "One_Work_软件设计说明书"),
    ("1ONE Work", "One Work"),
    ("1ONE Code", "One Work"),
    ("1ONE CLI", "Dream CLI"),
    ("1ONE", "One Work"),
]

for old, new in replacements:
    c = c.replace(old, new)

with open(p, 'w', encoding='utf-8') as f:
    f.write(c)

print('done')
# 验证
for line in c.split('\n')[:20]:
    if 'SOFTWARE_NAME' in line or 'OUTPUT' in line:
        print(line.strip())
