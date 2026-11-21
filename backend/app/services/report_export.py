"""Turns a report summary (app/services/report_summary.py) into a downloadable file.

Strategy pattern: one ReportExporter per format, chosen by ReportExporterFactory.get(fmt).
No extra libraries are needed: Excel (.xlsx) and PDF files are written by hand.

    csv   json   xlsx   pdf   html   md   txt
"""
from __future__ import annotations

import csv
import html
import io
import json
import zipfile
from abc import ABC, abstractmethod
from xml.sax.saxutils import escape as xml_escape

from app.domain.exceptions import InvalidInputError

COLUMNS = [('number', 'Incident'), ('title', 'Title'), ('status', 'Status'), ('priority', 'Priority'),
           ('category', 'Category'), ('service_name', 'Service'), ('place_type', 'Place'), ('building', 'Building'),
           ('room', 'Room'), ('reporter_name', 'Reported by'), ('assigned_name', 'Assigned to'),
           ('sla_status', 'SLA'), ('created_at', 'Created'), ('resolved_at', 'Resolved'),
           ('resolution_minutes', 'Resolution (min)'), ('lat', 'Latitude'), ('lng', 'Longitude')]

TOTAL_LABELS = {'created': 'Reports created', 'open': 'Still open', 'resolved_in_range': 'Resolved in this period',
                'breached': 'SLA breached', 'p1': 'Critical (P1)', 'offline_place': 'At a physical place',
                'online': 'Online / remote', 'avg_resolution_minutes': 'Avg resolution (min)'}


def _cell(v):
    return '' if v is None else v


def summary_lines(s: dict) -> list:
    """(label, value) pairs that head every export."""
    out = [('Report', f"BITS reports: {s['label']}"), ('Scope', s['scope']), ('From', s['from']), ('To', s['to'])]
    out += [(TOTAL_LABELS.get(k, k), _cell(v)) for k, v in s['totals'].items()]
    return out


def breakdowns(s: dict) -> list:
    return [('By priority', s['by_priority']), ('By status', s['by_status']), ('By category', s['by_category']),
            ('By building (physical places)', s['by_building'])]


class ReportExporter(ABC):
    ext = ''
    media_type = ''

    @abstractmethod
    def render(self, s: dict) -> bytes: ...


class CsvExporter(ReportExporter):
    ext, media_type = 'csv', 'text/csv'

    def render(self, s):
        buf = io.StringIO()
        w = csv.writer(buf)
        for k, v in summary_lines(s):
            w.writerow([k, v])
        w.writerow([])
        w.writerow([label for _, label in COLUMNS])
        for r in s['rows']:
            w.writerow([_cell(r.get(k)) for k, _ in COLUMNS])
        return ('﻿' + buf.getvalue()).encode('utf-8')     # BOM so Excel reads ₹ and names right


class JsonExporter(ReportExporter):
    ext, media_type = 'json', 'application/json'

    def render(self, s):
        return json.dumps({k: v for k, v in s.items() if k != 'map'}, indent=2, default=str).encode('utf-8')


class TextExporter(ReportExporter):
    ext, media_type = 'txt', 'text/plain'

    def render(self, s):
        lines = [f'{k:<26} {v}' for k, v in summary_lines(s)]
        for title, items in breakdowns(s):
            if items:
                lines += ['', title] + [f'  {i["name"]:<30} {i["value"]}' for i in items]
        lines += ['', 'Incidents']
        for r in s['rows']:
            lines.append(f"  {r['number']}  {r['priority'] or '--'}  {r['status']:<13} {r['title']}  "
                         f"({r.get('location') or r.get('place_type')}, {r.get('created_at')})")
        return '\n'.join(lines).encode('utf-8')


class MarkdownExporter(ReportExporter):
    ext, media_type = 'md', 'text/markdown'

    def render(self, s):
        esc = lambda v: str(_cell(v)).replace('|', '\\|')
        out = [f"# BITS reports: {s['label']}", '', f"_{s['scope']}, {s['from']} to {s['to']}_", '',
               '| Measure | Value |', '|---|---|'] + [f'| {k} | {esc(v)} |' for k, v in summary_lines(s)[4:]]
        for title, items in breakdowns(s):
            if items:
                out += ['', f'## {title}', ''] + [f'- {esc(i["name"])}: {i["value"]}' for i in items]
        cols = COLUMNS[:14]
        out += ['', '## Incidents', '', '| ' + ' | '.join(l for _, l in cols) + ' |', '|' + '---|' * len(cols)]
        out += ['| ' + ' | '.join(esc(r.get(k)) for k, _ in cols) + ' |' for r in s['rows']]
        return '\n'.join(out).encode('utf-8')


class HtmlExporter(ReportExporter):
    ext, media_type = 'html', 'text/html'

    def render(self, s):
        e = lambda v: html.escape(str(_cell(v)))
        kpis = ''.join(f'<div class="k"><b>{e(v)}</b><span>{e(k)}</span></div>' for k, v in summary_lines(s)[4:])
        parts = ''.join(f'<section><h3>{e(t)}</h3><ul>' + ''.join(f'<li>{e(i["name"])} <b>{e(i["value"])}</b></li>' for i in items)
                        + '</ul></section>' for t, items in breakdowns(s) if items)
        head = ''.join(f'<th>{e(l)}</th>' for _, l in COLUMNS)
        body = ''.join('<tr>' + ''.join(f'<td>{e(r.get(k))}</td>' for k, _ in COLUMNS) + '</tr>' for r in s['rows'])
        return f"""<!doctype html><html><head><meta charset="utf-8"><title>BITS reports: {e(s['label'])}</title>
<style>body{{font:14px system-ui,sans-serif;margin:32px;color:#1b1b1f}}h1{{margin:0}}.m{{color:#666}}
.ks{{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin:20px 0}}
.k{{border:1px solid #ddd;border-radius:10px;padding:10px}}.k b{{display:block;font-size:22px}}.k span{{color:#666;font-size:12px}}
.bd{{display:flex;gap:28px;flex-wrap:wrap}}ul{{padding-left:18px}}table{{border-collapse:collapse;width:100%;font-size:12px}}
td,th{{border:1px solid #ddd;padding:5px 7px;text-align:left}}th{{background:#f4f4f6}}@media print{{body{{margin:0}}}}</style></head>
<body><h1>BITS reports: {e(s['label'])}</h1><p class="m">{e(s['scope'])} · {e(s['from'])} to {e(s['to'])}</p>
<div class="ks">{kpis}</div><div class="bd">{parts}</div><h2>Incidents ({len(s['rows'])})</h2>
<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></body></html>""".encode('utf-8')


class XlsxExporter(ReportExporter):
    """A real Excel workbook (Summary + Incidents sheets), written as Office Open XML."""
    ext, media_type = 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

    @staticmethod
    def _col(i):
        s = ''
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s

    def _sheet(self, rows, widths=None):
        xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
               '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">']
        if widths:
            xml.append('<cols>' + ''.join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>'
                                          for i, w in enumerate(widths)) + '</cols>')
        xml.append('<sheetData>')
        for ri, (row, bold) in enumerate(rows, start=1):
            cells = []
            for ci, v in enumerate(row):
                ref = f'{self._col(ci)}{ri}'
                style = ' s="1"' if bold else ''
                if v is None or v == '':
                    continue
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    cells.append(f'<c r="{ref}"{style}><v>{v}</v></c>')
                else:
                    cells.append(f'<c r="{ref}" t="inlineStr"{style}><is><t xml:space="preserve">{xml_escape(str(v))}</t></is></c>')
            xml.append(f'<row r="{ri}">{"".join(cells)}</row>')
        xml.append('</sheetData></worksheet>')
        return ''.join(xml)

    def render(self, s):
        summary = [(['BITS reports', s['label']], True)] + [([k, v], False) for k, v in summary_lines(s)[1:]]
        for title, items in breakdowns(s):
            if items:
                summary += [([], False), ([title, 'Count'], True)] + [([i['name'], i['value']], False) for i in items]
        incidents = [([l for _, l in COLUMNS], True)] + [([r.get(k) for k, _ in COLUMNS], False) for r in s['rows']]
        widths = [12, 40, 13, 9, 20, 20, 10, 24, 8, 18, 18, 11, 26, 26, 15, 11, 11]
        files = {
            '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
            '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
            'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/>'
            '<sheet name="Incidents" sheetId="2" r:id="rId2"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
            'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
            '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
            '</styleSheet>',
            'xl/worksheets/sheet1.xml': self._sheet(summary, [32, 40]),
            'xl/worksheets/sheet2.xml': self._sheet(incidents, widths),
        }
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            for name, body in files.items():
                z.writestr(name, body)
        return buf.getvalue()


class PdfExporter(ReportExporter):
    """A plain landscape A4 PDF: summary, breakdowns, then the incident table over as many pages as needed."""
    ext, media_type = 'pdf', 'application/pdf'
    W, H, M = 842, 595, 36
    TABLE = [('number', 'Incident', 62), ('title', 'Title', 200), ('priority', 'Pri', 28), ('status', 'Status', 78),
             ('category', 'Category', 92), ('building', 'Building / place', 120), ('assigned_name', 'Assigned', 92),
             ('created_at', 'Created', 98)]

    @staticmethod
    def _t(v):
        s = str(_cell(v)).replace('₹', 'Rs ').encode('cp1252', 'replace').decode('cp1252')
        return s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')

    @staticmethod
    def _fit(text, width, size):
        max_chars = max(3, int(width / (size * 0.5)))
        text = str(text)
        return text if len(text) <= max_chars else text[:max_chars - 1] + '…'

    def render(self, s):
        pages, ops = [], []
        y = [self.H - self.M]

        def new_page():
            if ops:
                pages.append('\n'.join(ops))
            ops.clear()
            y[0] = self.H - self.M

        def text(x, s_, size=9, bold=False):
            ops.append(f'BT /{"F2" if bold else "F1"} {size} Tf {x:.1f} {y[0]:.1f} Td ({self._t(s_)}) Tj ET')

        def line(gap):
            y[0] -= gap
            if y[0] < self.M:
                new_page()

        text(self.M, f"BITS reports: {s['label']}", 18, True); line(20)
        text(self.M, f"{s['scope']}  |  {s['from'][:16].replace('T', ' ')} to {s['to'][:16].replace('T', ' ')} (UTC)", 9); line(22)
        items = summary_lines(s)[4:]
        for i in range(0, len(items), 4):
            for j, (k, v) in enumerate(items[i:i + 4]):
                x = self.M + j * 190
                text(x, v, 14, True)
            line(12)
            for j, (k, v) in enumerate(items[i:i + 4]):
                text(self.M + j * 190, k, 8)
            line(22)
        col_x = self.M
        top = y[0]
        longest = max([min(len(g), 10) for _, g in breakdowns(s) if g] or [0])
        for title, group in breakdowns(s):
            if not group:
                continue
            y[0] = top
            text(col_x, title, 10, True); y[0] -= 13
            for g in group[:10]:
                text(col_x, self._fit(f"{g['name']}: {g['value']}", 180, 8), 8); y[0] -= 11
            col_x += 192
        y[0] = top - 13 - 11 * longest - 18
        if y[0] < self.M + 40:
            new_page()

        def header():
            x = self.M
            for _, label, w in self.TABLE:
                text(x, label, 8, True); x += w
            ops.append(f'{self.M} {y[0] - 4:.1f} m {self.W - self.M} {y[0] - 4:.1f} l 0.6 G S')
            line(14)

        text(self.M, f"Incidents ({len(s['rows'])})", 11, True); line(16)
        header()
        for r in s['rows']:
            if y[0] < self.M + 12:
                new_page(); header()
            x = self.M
            for k, _, w in self.TABLE:
                v = r.get(k)
                if k == 'building':
                    v = r.get('building') or r.get('place_type')
                if k == 'created_at' and v:
                    v = str(v)[:16].replace('T', ' ')
                text(x, self._fit(_cell(v), w - 4, 8), 8); x += w
            line(12)
        new_page()

        objs = ['<< /Type /Catalog /Pages 2 0 R >>', None,
                '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
                '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']
        kids = []
        for i, content in enumerate(pages):
            stream = content + f'\nBT /F1 7 Tf {self.W - self.M - 40} 20 Td (Page {i + 1} of {len(pages)}) Tj ET'
            data = stream.encode('cp1252', 'replace')
            objs.append(f'<< /Length {len(data)} >>\nstream\n'.encode('latin-1') + data + b'\nendstream')
            objs.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.W} {self.H}] '
                        f'/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {len(objs)} 0 R >>')
            kids.append(len(objs))
        objs[1] = f'<< /Type /Pages /Kids [{" ".join(f"{k} 0 R" for k in kids)}] /Count {len(kids)} >>'
        out, offsets = io.BytesIO(), []
        out.write(b'%PDF-1.4\n')
        for i, o in enumerate(objs, start=1):
            offsets.append(out.tell())
            body = o if isinstance(o, bytes) else o.encode('latin-1')
            out.write(f'{i} 0 obj\n'.encode() + body + b'\nendobj\n')
        xref = out.tell()
        out.write(f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode())
        for off in offsets:
            out.write(f'{off:010d} 00000 n \n'.encode())
        out.write(f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
        return out.getvalue()


class ReportExporterFactory:
    _EXPORTERS = {e.ext: e for e in (CsvExporter(), JsonExporter(), XlsxExporter(), PdfExporter(),
                                     HtmlExporter(), MarkdownExporter(), TextExporter())}
    FORMATS = tuple(_EXPORTERS)

    @classmethod
    def get(cls, fmt: str) -> ReportExporter:
        e = cls._EXPORTERS.get((fmt or '').lower().lstrip('.'))
        if not e:
            raise InvalidInputError(f"format must be one of {', '.join(cls.FORMATS)}")
        return e
