' Starts the Next.js dev server with NO console window (SW_HIDE = 0).
' Inherits PATH (incl. GraphicsMagick/Ghostscript) from the launcher. No inner quotes.
Set sh = CreateObject("WScript.Shell")
proj = "C:\Users\trevo\Documents\GitHub\open-health"
sh.Run "cmd /c cd /d " & proj & " && npm run dev >> " & proj & "\server.log 2>&1", 0, False
