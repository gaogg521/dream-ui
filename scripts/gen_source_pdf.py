"""
生成软件著作权源代码鉴别材料 PDF
- 前30页 + 后30页，每页50行
- 页眉：软件名称 + 版本号
- 页码
"""
import os
import glob
from fpdf import FPDF

SOFTWARE_NAME = "1ONE Work 智能协作平台软件"
VERSION = "V2.1"
LINES_PER_PAGE = 50
PAGES = 30  # 前30页 + 后30页
PROJECT_ROOT = r"D:\aionui-m0\1oneUI"
OUTPUT = r"D:\aionui-m0\1oneUI\1ONE_Work_源代码鉴别材料.pdf"

# 中文字体（Windows 微软雅黑）
FONT_REG = r"C:\Windows\Fonts\msyh.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"


def collect_source_files(root):
    """收集所有 TS/TSX 源文件，按路径排序"""
    files = []
    for ext in ("*.ts", "*.tsx"):
        files.extend(glob.glob(os.path.join(root, "packages", "**", ext), recursive=True))
    # 排除 node_modules / out / dist
    files = [f for f in files if "node_modules" not in f and "\\out\\" not in f and "\\dist\\" not in f]
    files.sort()
    return files


def read_all_lines(files):
    """读取所有文件内容，合并为行列表，文件之间加注释分隔"""
    all_lines = []
    for f in files:
        rel = os.path.relpath(f, PROJECT_ROOT)
        all_lines.append(f"// ===== {rel} =====")
        try:
            with open(f, "r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    all_lines.append(line.rstrip("\n"))
        except Exception:
            all_lines.append("// [read error]")
        all_lines.append("")
    return all_lines


class SourcePDF(FPDF):
    def header(self):
        self.set_font("MSYH", "", 9)
        self.set_text_color(100, 100, 100)
        self.cell(0, 6, f"{SOFTWARE_NAME}  {VERSION}", align="L", new_x="LMARGIN", new_y="NEXT")
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(2)

    def footer(self):
        self.set_y(-15)
        self.set_font("MSYH", "", 9)
        self.set_text_color(100, 100, 100)
        self.cell(0, 10, f"- {self.page_no()} -", align="C")


def build_pdf(lines, output_path):
    pdf = SourcePDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=False)
    pdf.add_font("MSYH", "", FONT_REG)
    pdf.add_font("Consolas", "", FONT_MONO)
    pdf.set_margins(15, 18, 15)

    total = len(lines)
    # 前30页
    start_front = 0
    end_front = min(PAGES * LINES_PER_PAGE, total)
    # 后30页
    start_back = max(0, total - PAGES * LINES_PER_PAGE)
    end_back = total

    def dump_lines(seg_lines, start_page_no):
        for i, line in enumerate(seg_lines):
            if i % LINES_PER_PAGE == 0:
                pdf.add_page()
                pdf.set_font("Consolas", "", 7.5)
                pdf.set_text_color(0, 0, 0)
            # 行号
            page_local = i % LINES_PER_PAGE
            global_no = start_page_no + i + 1
            # 截断过长行
            text = line if len(line) <= 180 else line[:177] + "..."
            # 用等宽字体输出代码，中文行可能有问题，用MSYH兜底
            try:
                pdf.cell(10, 3.2, str(global_no), align="R")
                pdf.cell(0, 3.2, "  " + text, new_x="LMARGIN", new_y="NEXT")
            except Exception:
                pdf.set_font("MSYH", "", 7.5)
                pdf.cell(10, 3.2, str(global_no), align="R")
                pdf.cell(0, 3.2, "  " + text, new_x="LMARGIN", new_y="NEXT")
                pdf.set_font("Consolas", "", 7.5)

    # 前段
    front_lines = lines[start_front:end_front]
    dump_lines(front_lines, 0)
    # 后段
    back_lines = lines[start_back:end_back]
    dump_lines(back_lines, start_back)

    pdf.output(output_path)
    print(f"Generated: {output_path}")
    print(f"Total source lines: {total}")
    print(f"Front: lines {start_front}-{end_front} ({len(front_lines)} lines, {PAGES} pages)")
    print(f"Back:  lines {start_back}-{end_back} ({len(back_lines)} lines, {PAGES} pages)")


if __name__ == "__main__":
    files = collect_source_files(PROJECT_ROOT)
    print(f"Found {len(files)} source files")
    lines = read_all_lines(files)
    print(f"Total lines (with separators): {len(lines)}")
    build_pdf(lines, OUTPUT)
