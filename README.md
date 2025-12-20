# Talio HRMS - Complete Project Documentation

**Generated on:** December 11, 2025
**Project:** Talio HRMS (Human Resource Management System)

---

## 📚 Table of Contents
1. [Project Overview](#1-project-overview)
2. [Project Report Analysis](#2-project-report-analysis)
3. [MAYA AI Capabilities](#3-maya-ai-capabilities)
4. [Productivity Monitoring System](#4-productivity-monitoring-system)
5. [API Integration & Role-Based Access](#5-api-integration--role-based-access)
6. [Deployment Guide](#6-deployment-guide)
7. [Features Checklist](#7-features-checklist)
8. [Recent Fixes (Windows Capture)](#8-recent-fixes-windows-capture)

---

## 1. Project Overview

A comprehensive HRMS (Human Resource Management System) built with Next.js 14, MongoDB, and modern web technologies. This system is inspired by Zimyo and includes all essential HR management features.

### 🚀 Core Features
*   **Employee Management**: Complete lifecycle, profiles, hierarchy.
*   **Attendance & Time**: Clock in/out, shifts, biometric integration.
*   **Leave Management**: Applications, approvals, balances, calendar.
*   **Payroll**: Automated processing, payslips, tax, compliance.
*   **Performance**: KRAs, KPIs, OKRs, 360-degree feedback.
*   **Recruitment (ATS)**: Job postings, candidate pipeline, interviews.
*   **Engagement**: Announcements, surveys, social feed.
*   **Productivity**: Real-time screen monitoring and AI analysis.

### 🛠️ Tech Stack
*   **Frontend**: Next.js 14 (App Router), React 18, TailwindCSS
*   **Backend**: Node.js Custom Server + Next.js API Routes
*   **Real-time**: Socket.IO
*   **Database**: MongoDB with Mongoose ODM
*   **AI**: OpenAI / Gemini (MAYA Assistant)
*   **Desktop Apps**: Electron (macOS & Windows)

---

## 2. Project Report Analysis

### Abstract
Talio is a comprehensive, next-generation Human Resource Management System (HRMS) designed to unify fragmented HR processes into a single, intelligent platform. Built on a modern tech stack comprising Next.js 14, Node.js, and MongoDB, Talio integrates advanced AI capabilities through "MAYA" (My Advanced Year-round Assistant) and real-time productivity monitoring via custom desktop applications.

### Methodology
*   **Architecture**: Custom Node.js server integrating Next.js and Socket.IO for simultaneous REST API and real-time communication.
*   **AI (MAYA)**: Vector search for policy understanding and direct database action mapping (60+ actions).
*   **Monitoring**: Native Electron apps with `screenshot-desktop` for cross-platform capture.

### Results
*   **Coverage**: 15+ core modules fully implemented.
*   **AI**: MAYA can autonomously perform complex workflows like leave application and report generation.
*   **Monitoring**: High reliability on Windows and macOS with sub-second latency for instant captures.

---

## 3. MAYA AI Capabilities

MAYA has been upgraded with **COMPLETE ACTION CAPABILITIES** - she can now perform **EVERY action** that a user can do manually in the HRMS system!

### 🚀 Capabilities Overview (60+ Actions)
*   **Attendance**: Check in/out, mark attendance, request correction.
*   **Leave**: Apply, cancel, approve, reject, allocate balance.
*   **Tasks**: Create, update, assign, complete, delete.
*   **Expenses**: Submit, approve, reject.
*   **Recruitment**: Create jobs, schedule interviews, send offers.
*   **Database**: Read/Write access to 50+ collections.

### 🎯 How MAYA Works
1.  **Dashboard Actions**: Triggers UI events (e.g., clicking buttons).
2.  **Database Operations**: Direct MongoDB CRUD operations.
3.  **Context Awareness**: Uses vector search to understand queries in context.

---

## 4. Productivity Monitoring System

### 🎯 Features
*   **Automated Capture**: Configurable intervals (e.g., every 5 mins).
*   **Instant Capture**: Admin-triggered real-time screenshots via Socket.IO.
*   **AI Analysis**: GPT-4/Gemini analysis of screenshots for productivity scoring (0-100).
*   **Privacy**: Role-based access (Admin/Dept Head only), work-hours only.

### 🔄 Real-time Flow
1.  Desktop app captures screenshot.
2.  Uploads to `/api/maya/screen-capture`.
3.  Server calls AI for analysis (Productivity Score, Tips, Insights).
4.  Socket.IO notifies dashboard for real-time update.

---

## 5. API Integration & Role-Based Access

### 🔒 Security Model
*   **Authentication**: JWT Tokens with automatic refresh.
*   **RBAC**:
    *   **Admin**: Full access.
    *   **HR**: Employee & Payroll management.
    *   **Manager**: Team view & approvals.
    *   **Employee**: Self-service only.

### 📡 Key Endpoints
*   `GET /api/employees`: List employees (Paginated, Searchable).
*   `POST /api/leave`: Submit leave application.
*   `GET /api/productivity/instant-capture`: Request real-time screenshot.
*   `GET /api/departments`: Manage organizational structure.

---

## 6. Deployment Guide

### 📋 Prerequisites
*   **OS**: Ubuntu 20.04/22.04 LTS
*   **Runtime**: Node.js 18+, Docker, Docker Compose
*   **Database**: MongoDB Atlas or Local

### 🚀 Quick Deployment
```bash
# 1. Clone Repo
git clone <repo-url>
cd talio

# 2. Configure .env
cp .env.example .env
# Edit MONGODB_URI, JWT_SECRET, NEXTAUTH_URL

# 3. Start with Docker
docker-compose up -d --build
```

### 🔧 Manual Start
```bash
npm install
npm run build
npm run start # Runs 'node server.js'
```

---

## 7. Features Checklist

### ✅ Completed
*   **Foundation**: Next.js 14, MongoDB, Auth (JWT/NextAuth).
*   **Core Modules**: Employee, Attendance, Leave, Payroll, Performance.
*   **Operations**: Assets, Documents, Expenses, Travel.
*   **Engagement**: Announcements, Helpdesk, Policies.
*   **AI**: MAYA Assistant (Full Capabilities).
*   **Monitoring**: Desktop Apps (Win/Mac), Real-time tracking.

### 🔄 In Progress / Roadmap
*   Mobile App (React Native)
*   Advanced Biometric Integration
*   Video Interview Integration

---

## 8. Recent Fixes (Windows Capture)

### Issue
"Capture Now" was failing on Windows with "App is not running".

### Root Cause
The default `next dev` server does not support the custom Socket.IO implementation required for real-time signaling.

### Solution
1.  **Restored `server.js`**: Custom Node.js server to initialize Socket.IO + Next.js.
2.  **Socket Flag**: Added `socket.isDesktopApp = true` to correctly identify desktop clients.
3.  **Updated Scripts**: `npm run dev` now runs `node server.js`.

### Verification
*   Restart server: `npm run dev`
*   Restart Windows App.
*   "Capture Now" works immediately.
