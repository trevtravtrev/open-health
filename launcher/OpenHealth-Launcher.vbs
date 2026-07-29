' Silent OpenHealth launcher: runs OpenHealth-Launcher.bat with NO window (SW_HIDE = 0).
' The desktop shortcut targets THIS file directly. Paths have no spaces, so NO inner
' quotes are used (quoting the cmd /c line silently broke execution before).
Set sh = CreateObject("WScript.Shell")
proj = "C:\Users\trevo\Documents\GitHub\open-health"
sh.Run "cmd /c " & proj & "\launcher\OpenHealth-Launcher.bat >> " & proj & "\open-health-launcher.log 2>&1", 0, False
