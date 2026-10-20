#!/usr/bin/env python3
"""Convert a selected XLSX worksheet to UTF-8 CSV using only Python stdlib."""
import csv
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'p': 'http://schemas.openxmlformats.org/package/2006/relationships'}

def col_index(cell_ref):
    letters = re.match(r'[A-Z]+', cell_ref).group()
    value = 0
    for char in letters:
        value = value * 26 + ord(char) - 64
    return value - 1

def text_of(node):
    return ''.join(t.text or '' for t in node.findall('.//m:t', NS))

def main(filename, sheet_name):
    with zipfile.ZipFile(filename) as z:
        workbook = ET.fromstring(z.read('xl/workbook.xml'))
        rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        targets = {r.attrib['Id']: r.attrib['Target'] for r in rels}
        sheets = workbook.findall('.//m:sheets/m:sheet', NS)
        if not sheets:
            raise ValueError('Arquivo XLSX sem abas')
        selected = next((s for s in sheets if s.attrib.get('name') == sheet_name), None) if sheet_name else sheets[0]
        if selected is None:
            raise ValueError('Aba não encontrada. Disponíveis: ' + ', '.join(s.attrib['name'] for s in sheets))
        rid = selected.attrib['{' + NS['r'] + '}id']
        target = targets[rid].lstrip('/')
        if not target.startswith('xl/'):
            target = 'xl/' + target
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            root = ET.fromstring(z.read('xl/sharedStrings.xml'))
            shared = [text_of(si) for si in root.findall('m:si', NS)]
        root = ET.fromstring(z.read(target))
        rows = []
        for row in root.findall('.//m:sheetData/m:row', NS):
            values = {}
            for cell in row.findall('m:c', NS):
                ref = cell.attrib.get('r')
                if not ref:
                    continue
                idx = col_index(ref)
                kind = cell.attrib.get('t', '')
                val = cell.find('m:v', NS)
                raw = val.text if val is not None and val.text is not None else ''
                if kind == 's' and raw:
                    raw = shared[int(raw)]
                elif kind == 'inlineStr':
                    raw = text_of(cell)
                values[idx] = raw
            if values:
                rows.append([values.get(i, '') for i in range(max(values) + 1)])
        if not rows:
            raise ValueError('Aba vazia')
        width = max(len(r) for r in rows)
        out = io.StringIO()
        writer = csv.writer(out)
        for row in rows:
            writer.writerow(row + [''] * (width - len(row)))
        return out.getvalue(), selected.attrib['name']

if __name__ == '__main__':
    try:
        csv_text, sheet = main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '')
        sys.stderr.write(json.dumps({'sheet': sheet}) + '\n')
        sys.stdout.write(csv_text)
    except Exception as exc:
        sys.stderr.write(str(exc) + '\n')
        sys.exit(1)
