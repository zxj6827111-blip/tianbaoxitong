$ErrorActionPreference = 'Stop'

$excelPath = $env:EXCEL_PATH
$pdfPath = $env:PDF_PATH
if ([string]::IsNullOrWhiteSpace($excelPath) -or [string]::IsNullOrWhiteSpace($pdfPath)) {
  throw 'EXCEL_PATH and PDF_PATH are required.'
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

$workbook = $null

function Get-LastValueCell($sheet, [int]$searchOrder) {
  return $sheet.Cells.Find('*', $null, -4163, $null, $searchOrder, 2, $false, $false, $false)
}

function Resolve-PrintBounds($sheet) {
  $lastRowCell = Get-LastValueCell $sheet 1
  $lastColCell = Get-LastValueCell $sheet 2
  if (-not $lastRowCell -or -not $lastColCell) {
    return $null
  }

  $maxRow = [int]$lastRowCell.Row
  $maxCol = [int]$lastColCell.Column
  $scanEndRow = [Math]::Min($maxRow + 8, 500)

  # Expand bounds for merged title/header cells (e.g. cover page A3:M3).
  # Using value-only bounds may collapse to column A and cause blank first pages.
  for ($row = 1; $row -le $scanEndRow; $row++) {
    $cell = $sheet.Cells.Item($row, 1)
    if (-not $cell) { continue }
    if ($cell.MergeCells) {
      try {
        $mergeArea = $cell.MergeArea
        $mergeEndCol = [int]$mergeArea.Column + [int]$mergeArea.Columns.Count - 1
        $mergeEndRow = [int]$mergeArea.Row + [int]$mergeArea.Rows.Count - 1
        if ($mergeEndCol -gt $maxCol) { $maxCol = $mergeEndCol }
        if ($mergeEndRow -gt $maxRow) { $maxRow = $mergeEndRow }
      } catch {
      }
    }
  }

  return @{
    Rows = $maxRow
    Cols = $maxCol
  }
}

try {
  $workbook = $excel.Workbooks.Open($excelPath)
  foreach ($sheet in $workbook.Worksheets) {
    $bounds = Resolve-PrintBounds $sheet
    if (-not $bounds) { continue }

    $printRange = $sheet.Range($sheet.Cells.Item(1, 1), $sheet.Cells.Item($bounds.Rows, $bounds.Cols))
    # Enforce A4 landscape output for all sheets.
    $sheet.PageSetup.PaperSize = 9
    $sheet.PageSetup.Orientation = 2
    $sheet.PageSetup.PrintArea = $printRange.Address($false, $false)
    # Use width-fit to suppress phantom blank pages from stale page breaks.
    $sheet.PageSetup.Zoom = $false
    $sheet.PageSetup.FitToPagesWide = 1
    $sheet.PageSetup.FitToPagesTall = $false
    $sheet.ResetAllPageBreaks()
  }

  # Type=0 (xlTypePDF), Quality=0 (xlQualityStandard), keep PrintArea.
  $workbook.ExportAsFixedFormat(0, $pdfPath, 0, $true, $false)
} finally {
  if ($workbook) { $workbook.Close($false) | Out-Null }
  if ($excel) { $excel.Quit() | Out-Null }
}
