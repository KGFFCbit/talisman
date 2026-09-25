KGFFC CRASH KITCHEN  -  catch the PC in the act
===============================================

Your PC switches off by itself. We're going to record what it was doing right
up to the second it died, then let kgffc.net/crash/ point at the most likely
suspect. No installs, no admin, nothing uploaded.

WHAT'S IN THE BOX
  1-START-COOKING.bat   starts the recorder (double-click)
  2-PLATE-IT.bat        makes the file for the website (double-click)
  kgffc-crash.ps1       the actual recorder. Plain text: open it in Notepad and read it.
  kgffc-counters.txt    the "recipe": which Windows performance counters we record

FIRST TIME ONLY
  Only use a kit YOU downloaded from https://kgffc.net/crash/ . Never run a kit, .bat or
  .ps1 file that someone sent you, even if they say it is from us.
  Right-click the .zip you downloaded > Properties > tick "Unblock" > OK, then extract it
  somewhere easy like Documents\KGFFC-kit. If Windows says "Windows protected your PC",
  click "More info" then "Run anyway". (It says that about every script from the internet.)

EVERY TIME
  1. Double-click 1-START-COOKING. A black window opens. Leave it open. Minimise it.
  2. Play the game, use Photoshop, do whatever usually makes the PC die.
  3a. PC switched off?  Turn it back on, log in, double-click 2-PLATE-IT.
  3b. No crash?         Click the black window, press Q, then double-click 2-PLATE-IT anyway.
  4. A file called KGFFC-plate-(date).txt appears on your Desktop.
     Go to https://kgffc.net/crash/ and drop it on the page.

WANT TEMPERATURES AND VOLTAGES TOO?  (Extra Crispy mode, strongly recommended)
  Windows can't see CPU temperature or voltages by itself. The free program HWiNFO can.
  1. Get HWiNFO64 from https://www.hwinfo.com (the official site only). Choose "Sensors-only".
  2. In the sensors window, click the "Logging start" button (the little green page with a +).
  3. Save the log in the kit folder (next to the .bat files) and name it hwinfo.csv
  4. Start cooking as usual. 2-PLATE-IT finds the HWiNFO log by itself and adds it.

HOW TO BE A GOOD CRASH DETECTIVE
  * Record a boring 10 minutes first (desktop, no games). That is your "brine" baseline.
  * Change ONE thing at a time, then record again. Write down what you changed.
  * Anything inside the case (cables, power supply, cooler) is a grown-up job.
    Switch off at the wall first. Never open a power supply: it can hurt you even unplugged.

PRIVACY
  The file contains: your hardware model names, driver versions, Windows crash events,
  the numbers we recorded, and which app was busiest each second (app names only).
  It never contains your user name, PC name, IP address, serial numbers, folder paths,
  passwords or personal files. Open it in Notepad and check before sharing.
  Recordings stay on this PC in %LOCALAPPDATA%\KGFFC.

FOR THE WPA / PERFMON NERDS
  kgffc-counters.txt uses standard PDH counter paths. The recording is a plain CSV at
  %LOCALAPPDATA%\KGFFC\recordings\<date>\counters.csv, forced to disk every line so it
  survives a power cut. For deep dives, record an ETW trace with
  "wpr -start GeneralProfile -filemode" and open it in Windows Performance Analyzer.
