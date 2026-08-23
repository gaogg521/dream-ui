import re

p = r'D:\aionui-m0\1oneUI\scripts\gen_doc_docx.py'
with open(p, 'r', encoding='utf-8') as f:
    c = f.read()

# 按长度从长到短替换
replacements = [
    ("1ONE Work 智能协作平台软件", "One Work 智能协作平台软件"),
    ("1ONE_Work_软件设计说明书", "One_Work_软件设计说明书"),
    ("@dream/web-host", "@dream/web-host"),
    ("@aionui/", "@dream/"),
    ("AIONUI_", "DREAM_"),
    ("aioncore", "dreamcore"),
    ("aionrs", "dreamrs"),
    ("AionUi", "Dream"),
    ("AIONUI", "DREAM"),
    ("aionui", "dream"),
    ("AION_", "DREAM_"),
    ("1ONE Work", "One Work"),
    ("1ONE Code", "One Work"),
    ("1ONE CLI", "dream CLI"),
    ("1ONE", "One Work"),
    ("1oneUI", "dream"),
    ("1oneCore", "dreamcore"),
    ("one-org", "dream-domain-org"),
    ("one-enterprise", "dream-domain-enterprise"),
    ("one-sso", "dream-domain-sso"),
    ("one-billing", "dream-domain-billing"),
    ("one-employee", "dream-domain-employee"),
    ("one-devops", "dream-domain-devops"),
    ("one-platform", "dream-domain-platform"),
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
