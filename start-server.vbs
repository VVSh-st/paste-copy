Set WshShell = CreateObject("WScript.Shell")
Dim fso, scriptDir
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

Function IsPortListening()
    Dim exec, output
    Set exec = WshShell.Exec("cmd /c netstat -ano | findstr "":8765"" | findstr ""LISTENING""")
    output = exec.StdOut.ReadAll()
    IsPortListening = (InStr(output, "8765") > 0)
End Function

' Проверяем, не запущен ли уже сервер
If IsPortListening() Then
    WshShell.Run "http://localhost:8765", 1, False
Else
    Dim pyexe
    pyexe = scriptDir & "\python\python.exe"
    If fso.FileExists(pyexe) Then
        WshShell.Run """" & pyexe & """ -m http.server 8765", 0, False
    Else
        WshShell.Run "python -m http.server 8765", 0, False
    End If
    ' Ждём пока порт будет слушать (до 10 сек)
    Dim waited : waited = 0
    Do While waited < 10
        WScript.Sleep 1000
        waited = waited + 1
        If IsPortListening() Then Exit Do
    Loop
    WshShell.Run "http://localhost:8765", 1, False
End If
Set WshShell = Nothing
