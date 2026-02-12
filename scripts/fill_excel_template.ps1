$ErrorActionPreference = 'Stop'

$payloadBase64 = $env:PAYLOAD_BASE64
if ([string]::IsNullOrWhiteSpace($payloadBase64)) {
  throw 'PAYLOAD_BASE64 is required.'
}

$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payloadBase64))
$payload = $payloadJson | ConvertFrom-Json

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.Calculation = -4105

$sourcePath = $env:SOURCE_PATH
$templatePath = $env:TEMPLATE_PATH
$outputPath = $env:OUTPUT_PATH

$sourceWb = $null
$templateWb = $null

function Get-Sheet($workbook, $name) {
  try {
    return $workbook.Worksheets.Item($name)
  } catch {
    return $null
  }
}

function Copy-TemplateWorkbook($templatePath, $outputPath) {
  if (-not (Test-Path -LiteralPath $templatePath)) {
    throw "Template file not found: $templatePath"
  }

  $parentDir = Split-Path -Path $outputPath -Parent
  if (-not [string]::IsNullOrWhiteSpace($parentDir)) {
    [void](New-Item -ItemType Directory -Path $parentDir -Force -ErrorAction SilentlyContinue)
  }

  $lastError = $null
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      if (Test-Path -LiteralPath $outputPath) {
        try {
          Remove-Item -LiteralPath $outputPath -Force -ErrorAction Stop
        } catch {
          # Ignore delete failures here; Copy-Item may still overwrite.
        }
      }

      Copy-Item -LiteralPath $templatePath -Destination $outputPath -Force -ErrorAction Stop
      return
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds (200 * $attempt)
    }
  }

  $detail = if ($lastError) { $lastError.Exception.Message } else { 'unknown error' }
  throw "Copy template failed: $detail | template=$templatePath | output=$outputPath"
}

function Resolve-SourceSheet($workbook, $mapping) {
  if ($mapping.PSObject.Properties.Name -contains 'sourceCandidates' -and $mapping.sourceCandidates) {
    foreach ($candidate in $mapping.sourceCandidates) {
      $sheet = Get-Sheet $workbook $candidate
      if ($sheet) { return $sheet }
    }
  }

  if ($mapping.PSObject.Properties.Name -contains 'source' -and $mapping.source) {
    return Get-Sheet $workbook $mapping.source
  }

  return $null
}

function Replace-InSheet($sheet, [string]$findText, [string]$replaceText) {
  if (-not $sheet -or [string]::IsNullOrEmpty($findText)) { return }
  $null = $sheet.Cells.Replace($findText, $replaceText)
}

function Get-LastValueCell($sheet, [int]$searchOrder) {
  return $sheet.Cells.Find('*', $null, -4163, $null, $searchOrder, 2, $false, $false, $false)
}

function Get-ValueBounds($sheet) {
  $lastRowCell = Get-LastValueCell $sheet 1
  $lastColCell = Get-LastValueCell $sheet 2
  if (-not $lastRowCell -or -not $lastColCell) {
    return $null
  }

  return @{
    LastRow = [int]$lastRowCell.Row
    LastCol = [int]$lastColCell.Column
  }
}

function Get-SheetByCandidates($workbook, $names) {
  if (-not $names) { return $null }
  foreach ($name in $names) {
    if ([string]::IsNullOrWhiteSpace([string]$name)) { continue }
    $sheet = Get-Sheet $workbook $name
    if ($sheet) { return $sheet }
  }
  return $null
}

function Convert-ToNumber($raw) {
  if ($null -eq $raw) { return $null }
  if ($raw -is [byte] -or $raw -is [int16] -or $raw -is [int32] -or $raw -is [int64] -or $raw -is [single] -or $raw -is [double] -or $raw -is [decimal]) {
    return [double]$raw
  }

  $text = ([string]$raw).Trim()
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $text = $text.Replace(',', '')
  $value = 0.0
  if ([double]::TryParse($text, [ref]$value)) {
    return $value
  }
  return $null
}

function Test-HasNonZeroNumber($raw) {
  $num = Convert-ToNumber $raw
  if ($null -eq $num) { return $false }
  return [Math]::Abs([double]$num) -gt 0.000001
}

function Set-EstimatedRowHeight($cell, [string]$text) {
  if (-not $cell) { return }

  $lineText = [string]$text
  $normalized = $lineText.Replace("`r`n", "`n").Replace("`r", "`n")
  $parts = $normalized -split "`n"
  if (-not $parts -or $parts.Count -eq 0) { $parts = @('') }

  $mergeCols = 1
  if ($cell.MergeCells) {
    try {
      $mergeCols = [int]$cell.MergeArea.Columns.Count
    } catch {
      $mergeCols = 1
    }
  }
  $charsPerLine = [Math]::Max(14, $mergeCols * 11)
  $visualLines = 0
  foreach ($part in $parts) {
    $segment = [string]$part
    $visualLines += [Math]::Max(1, [Math]::Ceiling($segment.Length / $charsPerLine))
  }
  if ($visualLines -lt 1) { $visualLines = 1 }

  $baseHeight = 15.6
  try {
    $sheetBase = [double]$cell.Worksheet.StandardHeight
    if ($sheetBase -gt 0) { $baseHeight = $sheetBase }
  } catch {
  }

  $currentHeight = [double]$cell.EntireRow.RowHeight
  $targetHeight = [Math]::Min(409, [Math]::Max($currentHeight, [double]($visualLines * $baseHeight * 1.15)))
  try {
    $cell.EntireRow.RowHeight = $targetHeight
  } catch {
    try {
      [void]$cell.EntireRow.AutoFit()
    } catch {
    }
  }
}

function Set-TextCell($sheet, [string]$address, [string]$text) {
  if (-not $sheet -or [string]::IsNullOrWhiteSpace($address)) { return }
  $range = $sheet.Range($address)
  $range.Value2 = $text
  $range.WrapText = $true
  $range.ShrinkToFit = $false
  if ($range.MergeCells) {
    Set-EstimatedRowHeight $range ([string]$text)
  } else {
    [void]$range.EntireRow.AutoFit()
  }
}

function Set-TextBlock($sheet, [string]$address, [string]$text, [int]$maxRows = 220) {
  if (-not $sheet -or [string]::IsNullOrWhiteSpace($address)) { return }

  $anchor = $sheet.Range($address)
  $startRow = [int]$anchor.Row
  $startCol = [int]$anchor.Column

  if ($anchor.MergeCells) {
    try {
      $mergeArea = $anchor.MergeArea
      $mergeRows = [int]$mergeArea.Rows.Count
      $mergeCols = [int]$mergeArea.Columns.Count
      # The template uses vertical merge blocks (e.g. A3:A17) for text sections.
      # Keep content editable line-by-line by unmerging this block before writing.
      if ($mergeRows -gt 1 -and $mergeCols -eq 1) {
        [void]$mergeArea.UnMerge()
      }
    } catch {
      # Ignore unmerge failures and continue with best-effort writing.
    }
  }

  $normalized = ([string]$text).Replace("`r`n", "`n").Replace("`r", "`n")
  $normalized = [System.Text.RegularExpressions.Regex]::Replace($normalized, "(`n){3,}", "`n`n")
  $lines = $normalized -split "`n"
  if (-not $lines -or $lines.Count -eq 0) { $lines = @('') }

  $standardHeight = 15.6
  try {
    $sheetBase = [double]$sheet.StandardHeight
    if ($sheetBase -gt 0) { $standardHeight = $sheetBase }
  } catch {
  }

  $rowsToWrite = [Math]::Min($lines.Count, $maxRows)
  for ($i = 0; $i -lt $rowsToWrite; $i++) {
    $row = $startRow + $i
    $lineText = [string]$lines[$i]
    $cell = $sheet.Cells.Item($row, $startCol)
    $cell.Value2 = $lineText
    $cell.WrapText = $true
    $cell.ShrinkToFit = $false
    if ([string]::IsNullOrWhiteSpace($lineText)) {
      try {
        $sheet.Rows.Item($row).RowHeight = $standardHeight
      } catch {
      }
    } elseif ($cell.MergeCells) {
      Set-EstimatedRowHeight $cell $lineText
    } else {
      try {
        [void]$sheet.Rows.Item($row).AutoFit()
      } catch {
      }
    }
  }

  $clearStart = $startRow + $rowsToWrite
  $clearEnd = [Math]::Min($startRow + $maxRows - 1, 400)
  if ($clearStart -le $clearEnd) {
    for ($row = $clearStart; $row -le $clearEnd; $row++) {
      try {
        $cell = $sheet.Cells.Item($row, $startCol)
        if (-not [string]::IsNullOrWhiteSpace([string]$cell.Value2)) {
          $cell.Value2 = ''
        }
        $cell.ShrinkToFit = $false
        $sheet.Rows.Item($row).RowHeight = $standardHeight
      } catch {
      }
    }
  }
}

function Ensure-DirectoryProjectSection($sheet) {
  if (-not $sheet) { return }
  $target = '七、项目经费情况说明'
  $existingRow = $null
  $sectionSixRow = $null

  for ($row = 1; $row -le 80; $row++) {
    $text = ([string]$sheet.Cells.Item($row, 1).Text).Trim()
    if ($text -match '^七、\s*项目经费情况说明') {
      $existingRow = $row
      break
    }
    if ($text -match '^六、\s*其他相关情况说明') {
      $sectionSixRow = $row
    }
  }

  if ($existingRow) { return }

  $targetRow = if ($sectionSixRow) { $sectionSixRow + 1 } else { 19 }
  $cell = $sheet.Cells.Item($targetRow, 1)
  $cell.Value2 = $target
  $cell.WrapText = $true
  $cell.ShrinkToFit = $false
  try {
    [void]$sheet.Rows.Item($targetRow).AutoFit()
  } catch {
  }
}

function Test-FunctionBudgetTableEmpty($sheet) {
  if (-not $sheet) { return $true }
  $bounds = Get-ValueBounds $sheet
  if (-not $bounds) { return $true }

  $startRow = 9
  $endRow = [Math]::Min([int]$bounds.LastRow, 400)
  if ($endRow -lt $startRow) { return $true }

  for ($row = $startRow; $row -le $endRow; $row++) {
    foreach ($col in @(5, 6, 7)) {
      if (Test-HasNonZeroNumber($sheet.Cells.Item($row, $col).Value2)) {
        return $false
      }
    }
  }
  return $true
}

function Test-ThreePublicTableEmpty($sheet) {
  if (-not $sheet) { return $true }
  $bounds = Get-ValueBounds $sheet
  if (-not $bounds) { return $true }

  $startRow = 6
  $endRow = [Math]::Min([int]$bounds.LastRow, 200)
  $endCol = [Math]::Min([int]$bounds.LastCol, 12)
  if ($endRow -lt $startRow) { return $true }

  for ($row = $startRow; $row -le $endRow; $row++) {
    for ($col = 1; $col -le $endCol; $col++) {
      if (Test-HasNonZeroNumber($sheet.Cells.Item($row, $col).Value2)) {
        return $false
      }
    }
  }
  return $true
}

function Set-EmptyTableNote($sheet, [string]$noteText, [int]$mergeToCol = 7) {
  if (-not $sheet -or [string]::IsNullOrWhiteSpace($noteText)) { return }
  $bounds = Get-ValueBounds $sheet
  $targetRow = if ($bounds) { [int]$bounds.LastRow + 1 } else { 22 }
  if ($targetRow -lt 1) { $targetRow = 1 }

  for ($row = 1; $row -le [Math]::Min(500, $targetRow + 20); $row++) {
    $text = ([string]$sheet.Cells.Item($row, 1).Text).Trim()
    if ($text -match '^注[：:]') {
      $targetRow = $row
      break
    }
  }

  $noteRange = $sheet.Range($sheet.Cells.Item($targetRow, 1), $sheet.Cells.Item($targetRow, $mergeToCol))
  try {
    if ($noteRange.MergeCells) {
      [void]$noteRange.UnMerge()
    }
    [void]$noteRange.Merge()
  } catch {
  }

  $cell = $sheet.Cells.Item($targetRow, 1)
  $cell.Value2 = $noteText
  $cell.WrapText = $true
  $cell.ShrinkToFit = $false
  Set-EstimatedRowHeight $cell $noteText
}

function Apply-EmptyTableNotes($workbook, [int]$year) {
  if (-not $workbook) { return }
  $govSheet = Get-SheetByCandidates $workbook @('单位政府性基金拨款表', '单位政府性基金拨款表 ')
  if ($govSheet -and (Test-FunctionBudgetTableEmpty $govSheet)) {
    Set-EmptyTableNote $govSheet "注:本部门$($year)年无政府性基金预算财政拨款安排的预算，故本表为空表。"
  }

  $capitalSheet = Get-SheetByCandidates $workbook @('单位国有资本经营预算拨款表', '单位国有资本经营预算拨款表 ')
  if ($capitalSheet -and (Test-FunctionBudgetTableEmpty $capitalSheet)) {
    Set-EmptyTableNote $capitalSheet "注:本部门$($year)年无国有资本经营预算财政拨款安排的预算，故本表为空表。"
  }

  $threePublicSheet = Get-SheetByCandidates $workbook @('单位“三公”经费和机关运行费预算表', '单位“三公”经费和机关运行经费预算表')
  if ($threePublicSheet -and (Test-ThreePublicTableEmpty $threePublicSheet)) {
    $threePublicLabel = "$([char]0x201C)三公$([char]0x201D)"
    Set-EmptyTableNote $threePublicSheet ("注:本部门{0}年无{1}经费和机关运行经费预算，故本表为空表。" -f $year, $threePublicLabel)
  }
}

function Fix-NoteRowHeights($workbook) {
  if (-not $workbook) { return }
  foreach ($sheet in $workbook.Worksheets) {
    $bounds = Get-ValueBounds $sheet
    if (-not $bounds) { continue }
    $maxRow = [Math]::Min([int]$bounds.LastRow + 6, 500)
    for ($row = 1; $row -le $maxRow; $row++) {
      $cell = $sheet.Cells.Item($row, 1)
      $text = ([string]$cell.Text).Trim()
      if ($text -match '^注[：:]') {
        $cell.WrapText = $true
        $cell.ShrinkToFit = $false
        Set-EstimatedRowHeight $cell $text
      }
    }
  }
}

function Normalize-BudgetTableRowHeights($sheet) {
  if (-not $sheet) { return }
  $bounds = Get-ValueBounds $sheet
  if (-not $bounds) { return }

  $maxRow = [Math]::Min([int]$bounds.LastRow + 2, 500)
  $maxCol = [Math]::Min([int]$bounds.LastCol, 12)
  if ($maxCol -lt 1) { $maxCol = 1 }

  for ($row = 1; $row -le $maxRow; $row++) {
    try {
      $rowRange = $sheet.Range($sheet.Cells.Item($row, 1), $sheet.Cells.Item($row, $maxCol))
      $rowRange.WrapText = $true
      $rowRange.ShrinkToFit = $false
      $rowRange.VerticalAlignment = -4108
    } catch {
      continue
    }

    $rowText = ''
    $scanCols = [Math]::Min($maxCol, 6)
    for ($col = 1; $col -le $scanCols; $col++) {
      $part = ([string]$sheet.Cells.Item($row, $col).Text).Trim()
      if (-not [string]::IsNullOrWhiteSpace($part)) {
        $rowText += $part
      }
    }

    if ([string]::IsNullOrWhiteSpace($rowText)) { continue }

    if ($rowText -match '^注[：:]') {
      Set-EstimatedRowHeight $sheet.Cells.Item($row, 1) $rowText
      continue
    }

    try {
      [void]$sheet.Rows.Item($row).AutoFit()
    } catch {
    }

    try {
      $currentHeight = [double]$sheet.Rows.Item($row).RowHeight
      $minHeight = if ($row -le 8) { 22 } else { 18 }
      $maxHeight = if ($row -le 8) { 40 } else { 30 }
      if ($currentHeight -lt $minHeight) {
        $sheet.Rows.Item($row).RowHeight = $minHeight
      } elseif ($currentHeight -gt $maxHeight) {
        $sheet.Rows.Item($row).RowHeight = $maxHeight
      }
    } catch {
    }
  }
}

function Remove-DuplicateFiscalTotalRows($sheet) {
  if (-not $sheet) { return }
  $bounds = Get-ValueBounds $sheet
  if (-not $bounds) { return }

  $maxRow = [Math]::Min([int]$bounds.LastRow + 8, 300)
  $maxCol = [Math]::Min([int]$bounds.LastCol, 12)
  if ($maxCol -lt 1) { $maxCol = 1 }

  $totalRows = @()
  for ($row = 1; $row -le $maxRow; $row++) {
    $leftText = ([string]$sheet.Cells.Item($row, 1).Text).Trim()
    $midText = ([string]$sheet.Cells.Item($row, 3).Text).Trim()
    if ($leftText -eq '收入总计' -and $midText -eq '支出总计') {
      $hasNumber = (Test-HasNonZeroNumber($sheet.Cells.Item($row, 2).Value2)) `
        -or (Test-HasNonZeroNumber($sheet.Cells.Item($row, 4).Value2)) `
        -or (Test-HasNonZeroNumber($sheet.Cells.Item($row, 5).Value2))
      $totalRows += [PSCustomObject]@{
        Row = $row
        HasNumber = $hasNumber
      }
    }
  }

  if ($totalRows.Count -le 1) { return }

  $keepRow = $null
  foreach ($item in $totalRows) {
    if ($item.HasNumber) {
      $keepRow = [int]$item.Row
      break
    }
  }
  if (-not $keepRow) {
    $keepRow = [int]$totalRows[0].Row
  }

  foreach ($item in $totalRows) {
    $row = [int]$item.Row
    if ($row -eq $keepRow) { continue }
    try {
      $clearRange = $sheet.Range($sheet.Cells.Item($row, 1), $sheet.Cells.Item($row, $maxCol))
      [void]$clearRange.ClearContents()
    } catch {
    }
    try {
      $sheet.Rows.Item($row).RowHeight = [double]$sheet.StandardHeight
    } catch {
    }
  }
}

function Normalize-BudgetTableLayouts($workbook) {
  if (-not $workbook) { return }

  $budgetSheetCandidates = @(
    @('单位收支总表'),
    @('单位收入总表'),
    @('单位支出总表'),
    @('单位财政拨款收支总表'),
    @('单位一般公共预算拨款表'),
    @('单位政府性基金拨款表', '单位政府性基金拨款表 '),
    @('单位国有资本经营预算拨款表', '单位国有资本经营预算拨款表 ', '单位国有资本经营预算拨款表  '),
    @('单位一般公共预算拨款基本支出明细表'),
    @('单位“三公”经费和机关运行费预算表', '单位“三公”经费和机关运行经费预算表')
  )

  foreach ($candidates in $budgetSheetCandidates) {
    $sheet = Get-SheetByCandidates $workbook $candidates
    if ($sheet) {
      Normalize-BudgetTableRowHeights $sheet
    }
  }

  $fiscalSheet = Get-SheetByCandidates $workbook @('单位财政拨款收支总表')
  if ($fiscalSheet) {
    Remove-DuplicateFiscalTotalRows $fiscalSheet
  }
}

try {
  if (-not (Test-Path -LiteralPath $templatePath)) {
    throw "Template file not found: $templatePath"
  }
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Source file not found: $sourcePath"
  }

  # Work on a copied output workbook to avoid "template is read-only" SaveAs prompts in WPS/Excel COM.
  Copy-TemplateWorkbook $templatePath $outputPath
  try {
    $outputFile = Get-Item -LiteralPath $outputPath -ErrorAction Stop
    if ($outputFile.IsReadOnly) {
      $outputFile.IsReadOnly = $false
    }
  } catch {
    # Ignore attribute update failures and let subsequent save surface actionable error.
  }

  $sourceWb = $excel.Workbooks.Open($sourcePath)
  $templateWb = $excel.Workbooks.Open($outputPath)

  foreach ($mapping in $payload.sheetMap) {
    $sourceSheet = Resolve-SourceSheet $sourceWb $mapping
    $targetSheet = Get-Sheet $templateWb $mapping.target
    if (-not $sourceSheet -or -not $targetSheet) { continue }

    $bounds = Get-ValueBounds $sourceSheet
    if (-not $bounds) { continue }

    $rows = [int]$bounds.LastRow
    $cols = [int]$bounds.LastCol
    if ($rows -lt 1 -or $cols -lt 1) { continue }

    $sourceRange = $sourceSheet.Range($sourceSheet.Cells.Item(1, 1), $sourceSheet.Cells.Item($rows, $cols))
    $targetRange = $targetSheet.Range('A1').Resize($rows, $cols)

    # Copy full range directly to keep borders/merged cells stable.
    # Some source sheets may throw COM 0x800A03EC; fallback to value copy to avoid full generation failure.
    try {
      [void]$sourceRange.Copy($targetRange)
    } catch {
      $targetRange.Value2 = $sourceRange.Value2
    }
    $excel.CutCopyMode = $false
  }

  $year = [int]$payload.year
  $prevYear = [int]$payload.prevYear

  foreach ($sheetName in $payload.yearUpdateSheets) {
    $sheet = Get-Sheet $templateWb $sheetName
    if (-not $sheet) { continue }
    Replace-InSheet $sheet '2026' ([string]$year)
    Replace-InSheet $sheet '2025' ([string]$prevYear)
  }

  $directorySheet = Get-Sheet $templateWb $payload.sheetNames.directory
  if ($directorySheet) {
    Ensure-DirectoryProjectSection $directorySheet
  }

  if ($payload.coverUnitText) {
    $coverSheet = Get-Sheet $templateWb $payload.sheetNames.cover
    if ($coverSheet) {
      $coverSheet.Range('A9').Value2 = $payload.coverUnitText
    }
  }

  $functionsText = $payload.manualTexts.main_functions
  if ($functionsText) {
    $sheet = Get-Sheet $templateWb $payload.sheetNames.functions
    if ($sheet) { Set-TextBlock $sheet 'A3' $functionsText 220 }
  }

  $orgText = $payload.manualTexts.organizational_structure
  if ($orgText) {
    $sheet = Get-Sheet $templateWb $payload.sheetNames.org
    if ($sheet) { Set-TextBlock $sheet 'A3' $orgText 220 }
  }

  $glossaryText = $payload.manualTexts.glossary
  if ($glossaryText) {
    $sheet = Get-Sheet $templateWb $payload.sheetNames.glossary
    if ($sheet) { Set-TextBlock $sheet 'A3' $glossaryText 220 }
  }

  $otherText = $payload.manualTexts.other_notes
  if ($otherText) {
    $sheet = Get-Sheet $templateWb $payload.sheetNames.other
    if ($sheet) { Set-TextBlock $sheet 'A3' $otherText 260 }
  }

  $explanationText = $payload.manualTexts.explanation_block
  if ($explanationText) {
    $explainSheet = Get-Sheet $templateWb $payload.sheetNames.explanation
    if ($explainSheet) { Set-TextCell $explainSheet 'A3' $explanationText }
  }

  if ($payload.unitName) {
    foreach ($sheet in $templateWb.Worksheets) {
      Replace-InSheet $sheet 'XX（单位）' ([string]$payload.unitName)
      Replace-InSheet $sheet 'XX(单位)' ([string]$payload.unitName)
      Replace-InSheet $sheet 'XX（部门）' ([string]$payload.unitName)
      Replace-InSheet $sheet 'XX(部门)' ([string]$payload.unitName)
    }
  }

  $lineItems = $payload.lineItemLines
  if ($lineItems -and $lineItems.Count -gt 0) {
    $explainSheet = Get-Sheet $templateWb $payload.sheetNames.explanation
    if ($explainSheet) {
      $startRow = 4
      for ($i = 0; $i -lt $lineItems.Count; $i++) {
        $lineCell = $explainSheet.Range("A$($startRow + $i)")
        $lineCell.Value2 = $lineItems[$i]
        $lineCell.WrapText = $true
        $lineCell.ShrinkToFit = $false
        [void]$lineCell.EntireRow.AutoFit()
      }
      $clearStart = $startRow + $lineItems.Count
      if ($clearStart -le 200) {
        try {
          $clearRange = $explainSheet.Range($explainSheet.Cells.Item($clearStart, 1), $explainSheet.Cells.Item(200, 1))
          [void]$clearRange.ClearContents()
        } catch {
          for ($row = $clearStart; $row -le 200; $row++) {
            try {
              $explainSheet.Cells.Item($row, 1).Value2 = ''
            } catch {
              # Ignore row-level clear failures to avoid aborting whole generation.
            }
          }
        }
      }
    }
  }

  Normalize-BudgetTableLayouts $templateWb
  Apply-EmptyTableNotes $templateWb $year
  Fix-NoteRowHeights $templateWb

  try {
    $templateWb.Save()
  } catch {
    # Some COM hosts still treat copied .xls as protected; fallback to explicit SaveAs.
    $templateWb.SaveAs($outputPath, 56)
  }
} finally {
  try {
    if ($templateWb) { $templateWb.Close($true) | Out-Null }
  } catch {
    # Ignore close-time COM errors when workbook is already torn down by Excel.
  }
  try {
    if ($sourceWb) { $sourceWb.Close($false) | Out-Null }
  } catch {
  }
  try {
    if ($excel) { $excel.Quit() | Out-Null }
  } catch {
  }
}
