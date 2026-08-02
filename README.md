# AdminTAW

Plain HTML, CSS, and JavaScript admin helper for the House of Tutors / TAW Firebase Realtime Database.

## Run locally

Start a tiny local web server from this folder:

```powershell
python -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

## What it does

- Listens live to the Firebase Realtime Database configured in `firebase-config.js`.
- Provides focused CRUD screens for admins, students, classrooms, and attendance.
- Provides a generic Live Tree CRUD screen for any existing or newly added root node/subnode.
- Uses the same TAW paths found in the Flutter app: `ADMIN`, `STUDENTS`, `CLASSROOMS`, `ATTENDANCE`, `NUMBERS`, note folders, and homework folders.

Keep this tool private because it can write directly to your Firebase database.
