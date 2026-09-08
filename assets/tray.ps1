param(
    [string]$Title = 'Meowy Fooocus'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function Send-Command([string]$Command) {
    [Console]::Out.WriteLine($Command)
    [Console]::Out.Flush()
}

$script:notify = New-Object System.Windows.Forms.NotifyIcon
$script:notify.Icon = [System.Drawing.SystemIcons]::Application
$script:notify.Text = $Title
$script:notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenu
$openUi = New-Object System.Windows.Forms.MenuItem 'Open Fooocus UI'
$openUi.add_Click({ Send-Command 'open-ui' })
$openOutputs = New-Object System.Windows.Forms.MenuItem 'Open outputs folder'
$openOutputs.add_Click({ Send-Command 'open-outputs' })
$separator = New-Object System.Windows.Forms.MenuItem '-'
$exit = New-Object System.Windows.Forms.MenuItem 'Exit'
$exit.add_Click({ Send-Command 'exit' })
[void]$menu.MenuItems.Add($openUi)
[void]$menu.MenuItems.Add($openOutputs)
[void]$menu.MenuItems.Add($separator)
[void]$menu.MenuItems.Add($exit)
$script:notify.ContextMenu = $menu
$script:notify.add_DoubleClick({ Send-Command 'open-ui' })

$script:reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$script:pending = $script:reader.ReadLineAsync()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300
$timer.add_Tick({
    if ($script:pending.IsCompleted) {
        $line = $script:pending.Result
        if ($null -eq $line) {
            [System.Windows.Forms.Application]::Exit()
            return
        }
        if ($line.StartsWith('tooltip ')) {
            $text = $line.Substring(8)
            if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
            $script:notify.Text = $text
        }
        $script:pending = $script:reader.ReadLineAsync()
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()

$timer.Stop()
$script:notify.Visible = $false
$script:notify.Dispose()
