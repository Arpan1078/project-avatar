param(
  [string]$Workbook = 'reference-data/Dixie_Today_Scenario.xlsx',
  [string]$Output = 'data/regions/california/workbook-source.json'
)
# Read-only OOXML extraction using Windows/.NET; no Excel or third-party dependency.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$resolved = (Resolve-Path -LiteralPath $Workbook).Path
$zip = [IO.Compression.ZipFile]::OpenRead($resolved)
function Read-XmlPart([string]$name) {
  $entry = $zip.GetEntry($name)
  if (-not $entry) { return $null }
  $reader = New-Object IO.StreamReader($entry.Open())
  try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Text-Runs($node) {
  if (-not $node) { return '' }
  return (($node.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '')
}
function Resolve-Part([string]$base, [string]$target) {
  return ([Uri]::new([Uri]('https://ooxml.invalid/' + $base), $target)).AbsolutePath.TrimStart('/')
}
try {
  $shared = Read-XmlPart 'xl/sharedStrings.xml'
  $strings = @($shared.sst.si | ForEach-Object { Text-Runs $_ })
  $styles = Read-XmlPart 'xl/styles.xml'
  $formats = @{}
  foreach ($fmt in $styles.styleSheet.numFmts.numFmt) { if ($fmt) { $formats[[string]$fmt.numFmtId] = [string]$fmt.formatCode } }
  $book = Read-XmlPart 'xl/workbook.xml'
  $rels = Read-XmlPart 'xl/_rels/workbook.xml.rels'
  $targets = @{}
  foreach ($rel in $rels.Relationships.Relationship) { $targets[[string]$rel.Id] = Resolve-Part 'xl/workbook.xml' ([string]$rel.Target) }
  $sheets = @()
  foreach ($sheet in $book.workbook.sheets.sheet) {
    $id = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $part = $targets[$id]
    $xml = Read-XmlPart $part
    $sheetRels = Read-XmlPart ($part.Replace('worksheets/', 'worksheets/_rels/') + '.rels')
    $comments = @{}; $links = @{}
    if ($sheetRels) {
      foreach ($rel in $sheetRels.Relationships.Relationship) {
        $links[[string]$rel.Id] = [string]$rel.Target
        if ([string]$rel.Type -match '/comments$') {
          $cx = Read-XmlPart (Resolve-Part $part ([string]$rel.Target))
          foreach ($c in $cx.comments.commentList.comment) {
            $comments[[string]$c.ref] = [ordered]@{ author = [string]@($cx.comments.authors.author)[[int]$c.authorId]; text = (Text-Runs $c.text) }
          }
        }
      }
    }
    $hyperlinks = @{}
    foreach ($h in $xml.worksheet.hyperlinks.hyperlink) {
      if ($h) { $rid = $h.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'); $hyperlinks[[string]$h.ref] = [ordered]@{ target = $links[$rid]; location = [string]$h.location } }
    }
    $rows = @()
    foreach ($row in $xml.worksheet.sheetData.row) {
      $cells = @()
      foreach ($c in $row.c) {
        $type = [string]$c.t; $raw = [string]$c.v; $value = $null
        if ($type -eq 's') { $value = $strings[[int]$raw] }
        elseif ($type -eq 'inlineStr') { $value = Text-Runs $c.is }
        elseif ($type -eq 'b') { $value = $raw -eq '1' }
        elseif ($type -eq 'str' -or $type -eq 'e') { $value = $raw }
        elseif ($raw -ne '') { $value = [double]::Parse($raw, [Globalization.CultureInfo]::InvariantCulture) }
        $styleIndex = if ($c.HasAttribute('s')) { [int]$c.s } else { 0 }
        $formatId = [string]$styles.styleSheet.cellXfs.xf[$styleIndex].numFmtId
        if ($null -ne $value -or $c.f -or $comments.ContainsKey([string]$c.r)) {
          $cells += [ordered]@{ ref = [string]$c.r; value = $value; type = $type; numberFormatId = $formatId; numberFormat = $formats[$formatId]; formula = $(if ($c.f) { $c.SelectSingleNode('*[local-name()="f"]').InnerText } else { $null }); comment = $comments[[string]$c.r]; hyperlink = $hyperlinks[[string]$c.r] }
        }
      }
      if ($cells.Count) { $rows += [ordered]@{ row = [int]$row.r; cells = $cells } }
    }
    $sheets += [ordered]@{ name = [string]$sheet.name; dimension = [string]$xml.worksheet.dimension.ref; rows = $rows }
  }
  $data = [ordered]@{ schemaVersion = '1.0.0'; source = [ordered]@{ path = $Workbook.Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLower(); date1904 = [string]$book.workbook.workbookPr.date1904; extraction = 'Read-only OOXML values, cached formulas, formats, hyperlinks and cell comments; no recalculation' }; sheets = $sheets }
  [IO.File]::WriteAllText((Join-Path (Get-Location) $Output), ($data | ConvertTo-Json -Depth 30) + "`n", (New-Object Text.UTF8Encoding($false)))
  $sheets | ForEach-Object { '{0}: {1} populated rows' -f $_.name, $_.rows.Count }
} finally { $zip.Dispose() }
