"""Compile the unchanged production state module using the repository's cached Rust dependencies."""
from pathlib import Path
import subprocess, tempfile, sys
root = Path(__file__).resolve().parents[2]
deps = root / 'src-tauri/target/debug/deps'
with tempfile.TemporaryDirectory(prefix='chatless-native-review-') as temp:
    binary = Path(temp) / 'probe'
    command = ['rustc', '--edition=2021', str(Path(__file__).with_suffix('.rs')), '-L', f'dependency={deps}', '-o', str(binary)]
    if '--controls' in sys.argv: command += ['--test']
    for crate in ['tauri', 'tokio', 'serde', 'serde_json']:
        choices = sorted(deps.glob(f'lib{crate}-*.rlib'), key=lambda p: p.stat().st_mtime, reverse=True)
        if not choices: raise SystemExit(f'Missing cached dependency: {crate}; run a native build first.')
        command += ['--extern', f'{crate}={choices[0]}']
    for folder in (root / 'src-tauri/target/debug/build').glob('*/out'):
        command += ['-L', f'native={folder}']
    subprocess.run(command, check=True)
    raise SystemExit(subprocess.run([str(binary)]).returncode)
