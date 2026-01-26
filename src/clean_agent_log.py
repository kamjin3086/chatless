import re
from pathlib import Path

# 要处理的扩展名
EXTENSIONS = {'.ts', '.tsx'}

# 匹配从 // #region agent log 到 // #endregion 的整块（包含首尾两行）
# 使用非贪婪匹配 + 多行模式
REGION_PATTERN = re.compile(
    r'^\s*// #region agent log\s*?\n'   # 开头行（允许前面有空格）
    r'(?:.*\n)*?'                        # 中间任意内容（非贪婪）
    r'^\s*// #endregion\s*?$',           # 结尾行
    re.MULTILINE
)


def clean_file(file_path: Path) -> bool:
    """处理单个文件，返回是否真的有修改"""
    original_content = file_path.read_text(encoding='utf-8')
    
    # 直接替换匹配到的整块为 空字符串（也就是删除）
    new_content = REGION_PATTERN.sub('', original_content)
    
    # 可选：压缩多余空行（连续3行以上空行压缩为2行）
    # new_content = re.sub(r'\n{3,}', '\n\n', new_content)
    
    if original_content == new_content:
        return False
    
    # 写回文件（末尾保证有一个换行）
    file_path.write_text(new_content.rstrip() + '\n', encoding='utf-8')
    print(f"已清理: {file_path}")
    return True


def process_directory(root_dir: Path | str = "."):
    """递归处理当前目录及所有子目录"""
    root = Path(root_dir).resolve()
    modified_count = 0
    file_count = 0
    
    print(f"开始扫描目录: {root}\n")
    
    for file_path in root.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in EXTENSIONS:
            continue
            
        file_count += 1
        if clean_file(file_path):
            modified_count += 1
    
    print("\n" + "="*60)
    print(f"扫描完成！")
    print(f"  共找到 {file_count} 个 .ts / .tsx 文件")
    print(f"  其中修改了 {modified_count} 个文件")
    print("="*60)


if __name__ == "__main__":
    # 默认处理当前目录
    process_directory()
    
    # 如果想指定其他目录，可以改成：
    # process_directory("./src")
    # process_directory(r"D:\projects\my-app")