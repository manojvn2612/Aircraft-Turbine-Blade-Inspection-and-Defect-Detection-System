# Aircraft Turbine Blade Inspection and Defect Detection System
Plane blade Damage Detection System

## Overview

This project is a full end to end plane engine blade damage detection system developed Bharat Forge Ltd.

The system consists of:

- Backend: HR-net Based defect detection system
- Frontend: React + TypeScript application
- WebSocket-based communication
- Camera capture and result visualization 

---

## Project Structure

```text
Aircraft-Turbine-Blade-Inspection-and-Defect-Detection-System/
├── Backend/
│   ├── models/
│   │   ├── hr_net.pth
│   │   └── blade_detect.pt
│   ├── main.py
│   ├── hrnet_model.py
│   ├── model.py
│   ├── uvcham.py
│   ├── pic_clicker.py
│   ├── uvcham.dll
│   ├── labeling.py
│   ├── camera_start.py
│   └── Blade_angles.xlsx
│
├── frontend/
│   ├── src/
│   │   ├── assets/
│   │   │   ├── App.css
│   │   │   ├── App.jsx
│   │   │   ├── index.css
│   │   │   └── main.jsx
│   ├── package.json
│   └── package-lock.json
│
├── storage/
├── defective/
├── results/
├── retrain/
├── uploads/
│
├── .env
├── requirements.txt
├── .gitignore
└── README.md
```

## Launch app
```git clone https://github.com/manojvn2612/Aircraft-Turbine-Blade-Inspection-and-Defect-Detection-System.git```

### create a virtual environment
**DO all this in terminal respectively**

```py -m venv bfl_venv #u can name it as u want no compulsion```

```bfl_venv/Scripts/Activate```

```pip install -r "requirements.txt"```

go to frontend and run in terminal

```npm install```

#### run apps

go to backend folder in terminal with activated virtual environment

```py main.py```

go to frontend folder in terminal 

npm run dev # for development but can use for small testig too

Done..... :)

if any doubt contact this git repo owner using mail feature in git for ref attaching my mail id
manojvnayak@outlook.in