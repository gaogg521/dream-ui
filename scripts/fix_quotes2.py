import re

p = r'D:\aionui-m0\1oneUI\scripts\gen_doc_docx.py'
with open(p, 'r', encoding='utf-8') as f:
    lines = f.readlines()

fixed = []
for line in lines:
    # 只处理包含 add_para / add_bullet / add_heading / set_font 等字符串调用的行
    # 把这些行中第一个 ( 之后、最后一个 ) 之前的内嵌双引号替换
    if any(k in line for k in ['add_para(', 'add_bullet(', 'add_heading(', 'set_font(', 'run = p.add_run', 'r1 = p.add_run', 'r2 = p.add_run', 'terms = [', '("', '", "']):
        # 找到第一个 " 和最后一个 " 之间的内容，替换中间的 "
        first = line.find('"')
        last = line.rfind('"')
        if first != -1 and last != -1 and last > first:
            inner = line[first+1:last]
            inner = inner.replace('"', '「', 1)  # 第一个内嵌的变左引号
            # 剩余的交替替换
            result = []
            toggle = True  # True=右引号, False=左引号
            for ch in inner:
                if ch == '"':
                    result.append('」' if toggle else '「')
                    toggle = not toggle
                else:
                    result.append(ch)
            line = line[:first+1] + ''.join(result) + line[last:]
    fixed.append(line)

with open(p, 'w', encoding='utf-8') as f:
    f.writelines(fixed)

print('done')
print(fixed[167][:120])
