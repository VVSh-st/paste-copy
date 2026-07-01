Set WshShell = CreateObject("WScript.Shell")
Dim fso, scriptDir
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' Проверяем, не запущен ли уже сервер
Dim exec, output
Set exec = WshShell.Exec("cmd /c netstat -ano | findstr "":8080""")
output = exec.StdOut.ReadAll()
If InStr(output, "8080") > 0 Then
    WshShell.Run "http://localhost:8080", 1, False
Else
    Dim pyexe
    pyexe = scriptDir & "\python\python.exe"
    If fso.FileExists(pyexe) Then
        WshShell.Run """" & pyexe & """ -m http.server 8080", 0, False
    Else
        WshShell.Run "python -m http.server 8080", 0, False
    End If
    WScript.Sleep 2000
    WshShell.Run "http://localhost:8080", 1, False
End If
Set WshShell = Nothing
