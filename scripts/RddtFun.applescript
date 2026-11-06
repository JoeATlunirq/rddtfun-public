-- Source for ~/Applications/RddtFun.app. Rebuild:
--   osacompile -o ~/Applications/RddtFun.app scripts/RddtFun.applescript
--   cp scripts/RddtFun.icns ~/Applications/RddtFun.app/Contents/Resources/applet.icns
--   rm ~/Applications/RddtFun.app/Contents/Resources/Assets.car
--   plutil -remove CFBundleIconName ~/Applications/RddtFun.app/Contents/Info.plist
--   codesign --force --deep -s - ~/Applications/RddtFun.app
set appURL to "http://localhost:5173"
-- Path to your clone, relative to your home folder. Change it if you cloned somewhere else.
set repoPath to "Code Projects/RddtFun"
set startScript to (POSIX path of (path to home folder)) & repoPath & "/scripts/start-local.sh"

set serverStatus to do shell script "(lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null && lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null) && echo up || echo down"

if serverStatus is "up" then
	open location appURL
else
	tell application "Terminal"
		activate
		do script quoted form of startScript
	end tell
end if
