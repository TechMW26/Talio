import {
  HiOutlineSquares2X2,
  HiOutlineChatBubbleLeftRight,
  HiOutlineEnvelope,
  HiOutlineRectangleGroup,
  HiOutlineClipboardDocumentList,
  HiOutlineUserGroup,
  HiOutlineClock,
  HiOutlineBanknotes,
  HiOutlineTrophy,
  HiOutlineBriefcase,
  HiOutlineUserPlus,
  HiOutlineArrowRightOnRectangle,
  HiOutlineDocumentText,
  HiOutlineCube,
  HiOutlineReceiptPercent,
  HiOutlineLifebuoy,
  HiOutlineBookOpen,
  HiOutlineAcademicCap,
  HiOutlineMegaphone,
  HiOutlineCalendarDays,
  HiOutlineChartBar,
  HiOutlineVideoCamera,
  HiOutlineComputerDesktop,
  HiOutlineListBullet,
  HiOutlineSignal,
  HiOutlineLightBulb,
  HiOutlineShieldCheck,
} from 'react-icons/hi2'

// Define menu items for each role
// Each item has an optional `group` field used by the sidebar to render section headings
// NOTE: MIRA AI Assistant is only available in the desktop apps (Mac/Windows) via floating widget
// It has been removed from the web version entirely
export const roleBasedMenus = {
  // ADMIN - Full access to everything
  admin: [
    { name: 'Dashboard', icon: HiOutlineSquares2X2, path: '/dashboard', group: 'Main' },
    { name: 'Chat', icon: HiOutlineChatBubbleLeftRight, path: '/dashboard/chat', group: 'Main' },
    { name: 'Mail', icon: HiOutlineEnvelope, path: '/dashboard/mail', group: 'Main' },
    { name: 'Meetings', icon: HiOutlineVideoCamera, path: '/dashboard/meetings', group: 'Main' },
    { name: "To-Do's", icon: HiOutlineListBullet, path: '/dashboard/todo', group: 'Main' },
    { name: 'TalioBoard', icon: HiOutlineRectangleGroup, path: '/dashboard/talioboard', group: 'Main' },
    {
      name: 'Projects',
      icon: HiOutlineClipboardDocumentList,
      path: '/dashboard/projects',
      group: 'Work',
      submenu: [
        { name: 'All Projects', path: '/dashboard/projects' },
        { name: 'My Tasks', path: '/dashboard/projects/my-tasks' },
        { name: 'Assigned Tasks', path: '/dashboard/projects/assigned-tasks' },
        { name: 'Pending Approvals', path: '/dashboard/projects/approvals' },
        { name: 'Create Project', path: '/dashboard/projects/create' },
      ]
    },
    {
      name: 'Attendance & Leaves',
      icon: HiOutlineClock,
      path: '/dashboard/attendance',
      group: 'Work',
      submenu: [
        { name: 'My Attendance', path: '/dashboard/attendance' },
        { name: 'Team Attendance', path: '/dashboard/attendance/team' },
        { name: 'Attendance Report', path: '/dashboard/attendance/report' },
        { name: 'Employee Check-ins', path: '/dashboard/attendance/checkins' },
        { name: 'Attendance Regularisation', path: '/dashboard/team/regularisation' },
        { name: 'Apply Leave', path: '/dashboard/leave/apply' },
        { name: 'My Leave Balance', path: '/dashboard/leave/balance' },
        { name: 'Leave Requests', path: '/dashboard/leave/requests' },
        { name: 'Leave Approvals', path: '/dashboard/leave/approvals' },
        { name: 'Leave Types', path: '/dashboard/leave-types' },
        { name: 'Leave Allocations', path: '/dashboard/leave/allocations' },
      ]
    },
    { name: 'Productivity', icon: HiOutlineComputerDesktop, path: '/dashboard/productivity', group: 'Work' },
    {
      name: 'Employees',
      icon: HiOutlineUserGroup,
      path: '/dashboard/employees',
      group: 'People',
      submenu: [
        { name: 'All Employees', path: '/dashboard/employees' },
        { name: 'Add Employee', path: '/dashboard/employees/add' },
        { name: 'Onboarding Emails', path: '/dashboard/employees/onboarding-emails' },
        { name: 'Departments', path: '/dashboard/departments' },
        { name: 'Designations', path: '/dashboard/designations' },
        { name: 'User Passwords', path: '/dashboard/employees/user-passwords' },
      ]
    },
    { name: 'Live Users', icon: HiOutlineSignal, path: '/dashboard/admin/live-users', group: 'People' },
    {
      name: 'Performance',
      icon: HiOutlineTrophy,
      path: '/dashboard/performance',
      group: 'People',
      submenu: [
        { name: 'My Performance', path: '/dashboard/performance/my-performance' },
        { name: 'Employee Ratings', path: '/dashboard/performance/ratings' },
        { name: 'Goals & Objectives', path: '/dashboard/performance/goals' },
        { name: 'Performance Reports', path: '/dashboard/performance/reports' },
      ]
    },
    {
      name: 'Recruitment',
      icon: HiOutlineBriefcase,
      path: '/dashboard/recruitment',
      group: 'People',
      submenu: [
        { name: 'Job Openings', path: '/dashboard/recruitment' },
        { name: 'Candidates', path: '/dashboard/recruitment/candidates' },
        { name: 'Interviews', path: '/dashboard/recruitment/interviews' },
        { name: 'Analytics', path: '/dashboard/recruitment/analytics' },
      ]
    },
    {
      name: 'Payroll',
      icon: HiOutlineBanknotes,
      path: '/dashboard/payroll',
      group: 'Finance',
      submenu: [
        { name: 'Process Payroll', path: '/dashboard/payroll' },
        { name: 'Generate Payroll', path: '/dashboard/payroll/generate' },
        { name: 'Payslips', path: '/dashboard/payroll/payslips' },
      ]
    },
    {
      name: 'Expenses',
      icon: HiOutlineReceiptPercent,
      path: '/dashboard/expenses',
      group: 'Finance',
      submenu: [
        { name: 'My Expenses', path: '/dashboard/expenses' },
        { name: 'Approvals', path: '/dashboard/expenses/approvals' },
      ]
    },
    { name: 'Documents', icon: HiOutlineDocumentText, path: '/dashboard/documents', group: 'Resources' },
    { name: 'Assets', icon: HiOutlineCube, path: '/dashboard/assets', group: 'Resources' },
    { name: 'Helpdesk', icon: HiOutlineLifebuoy, path: '/dashboard/helpdesk', group: 'Resources' },
    { name: 'Policies', icon: HiOutlineBookOpen, path: '/dashboard/policies', group: 'Resources' },
    { name: 'Ideas', icon: HiOutlineLightBulb, path: '/dashboard/sandbox', group: 'Resources' },
    {
      name: 'Learning (LMS)',
      icon: HiOutlineAcademicCap,
      path: '/dashboard/learning',
      group: 'Resources',
      submenu: [
        { name: 'Courses', path: '/dashboard/learning/courses' },
        { name: 'My Trainings', path: '/dashboard/learning/trainings' },
        { name: 'Certificates', path: '/dashboard/learning/certificates' },
      ]
    },
    {
      name: 'Announcements',
      icon: HiOutlineMegaphone,
      path: '/dashboard/announcements',
      group: 'Company',
      submenu: [
        { name: 'All Announcements', path: '/dashboard/announcements' },
        { name: 'Create Announcement', path: '/dashboard/announcements/create' },
      ]
    },
    { name: 'Holidays', icon: HiOutlineCalendarDays, path: '/dashboard/holidays', group: 'Company' },
    { name: 'General Calendar', icon: HiOutlineCalendarDays, path: '/dashboard/calendar', group: 'Company' },
    { name: 'Role Management', icon: HiOutlineShieldCheck, path: '/dashboard/rbac/roles', group: 'Company' },
  ],

  // HR - Full HR management access (similar to admin for HR functions)
  hr: [
    { name: 'Dashboard', icon: HiOutlineSquares2X2, path: '/dashboard', group: 'Main' },
    { name: 'Chat', icon: HiOutlineChatBubbleLeftRight, path: '/dashboard/chat', group: 'Main' },
    { name: 'Mail', icon: HiOutlineEnvelope, path: '/dashboard/mail', group: 'Main' },
    { name: 'Meetings', icon: HiOutlineVideoCamera, path: '/dashboard/meetings', group: 'Main' },
    { name: "To-Do's", icon: HiOutlineListBullet, path: '/dashboard/todo', group: 'Main' },
    { name: 'TalioBoard', icon: HiOutlineRectangleGroup, path: '/dashboard/talioboard', group: 'Main' },
    {
      name: 'Projects',
      icon: HiOutlineClipboardDocumentList,
      path: '/dashboard/projects',
      group: 'Work',
      submenu: [
        { name: 'All Projects', path: '/dashboard/projects' },
        { name: 'My Tasks', path: '/dashboard/projects/my-tasks' },
        { name: 'Assigned Tasks', path: '/dashboard/projects/assigned-tasks' },
        { name: 'Pending Approvals', path: '/dashboard/projects/approvals' },
        { name: 'Create Project', path: '/dashboard/projects/create' },
      ]
    },
    {
      name: 'Attendance & Leaves',
      icon: HiOutlineClock,
      path: '/dashboard/attendance',
      group: 'Work',
      submenu: [
        { name: 'My Attendance', path: '/dashboard/attendance' },
        { name: 'Team Attendance', path: '/dashboard/attendance/team' },
        { name: 'Attendance Report', path: '/dashboard/attendance/report' },
        { name: 'Employee Check-ins', path: '/dashboard/attendance/checkins' },
        { name: 'Attendance Regularisation', path: '/dashboard/team/regularisation' },
        { name: 'Apply Leave', path: '/dashboard/leave/apply' },
        { name: 'My Leave Balance', path: '/dashboard/leave/balance' },
        { name: 'Leave Requests', path: '/dashboard/leave/requests' },
        { name: 'Leave Approvals', path: '/dashboard/leave/approvals' },
        { name: 'Leave Types', path: '/dashboard/leave-types' },
        { name: 'Leave Allocations', path: '/dashboard/leave/allocations' },
      ]
    },
    { name: 'Productivity', icon: HiOutlineComputerDesktop, path: '/dashboard/productivity', group: 'Work' },
    {
      name: 'Employees',
      icon: HiOutlineUserGroup,
      path: '/dashboard/employees',
      group: 'People',
      submenu: [
        { name: 'All Employees', path: '/dashboard/employees' },
        { name: 'Add Employee', path: '/dashboard/employees/add' },
        { name: 'Onboarding Emails', path: '/dashboard/employees/onboarding-emails' },
        { name: 'Departments', path: '/dashboard/departments' },
        { name: 'Designations', path: '/dashboard/designations' },
        { name: 'User Passwords', path: '/dashboard/employees/user-passwords' },
      ]
    },
    { name: 'Live Users', icon: HiOutlineSignal, path: '/dashboard/admin/live-users', group: 'People' },
    {
      name: 'Performance',
      icon: HiOutlineTrophy,
      path: '/dashboard/performance',
      group: 'People',
      submenu: [
        { name: 'My Performance', path: '/dashboard/performance/my-performance' },
        { name: 'Employee Ratings', path: '/dashboard/performance/ratings' },
        { name: 'Goals & Objectives', path: '/dashboard/performance/goals' },
        { name: 'Performance Reports', path: '/dashboard/performance/reports' },
      ]
    },
    {
      name: 'Recruitment',
      icon: HiOutlineBriefcase,
      path: '/dashboard/recruitment',
      group: 'People',
      submenu: [
        { name: 'Job Openings', path: '/dashboard/recruitment' },
        { name: 'Candidates', path: '/dashboard/recruitment/candidates' },
        { name: 'Interviews', path: '/dashboard/recruitment/interviews' },
        { name: 'Analytics', path: '/dashboard/recruitment/analytics' },
      ]
    },
    {
      name: 'Payroll',
      icon: HiOutlineBanknotes,
      path: '/dashboard/payroll',
      group: 'Finance',
      submenu: [
        { name: 'Process Payroll', path: '/dashboard/payroll' },
        { name: 'Generate Payroll', path: '/dashboard/payroll/generate' },
        { name: 'Payslips', path: '/dashboard/payroll/payslips' },
      ]
    },
    {
      name: 'Expenses',
      icon: HiOutlineReceiptPercent,
      path: '/dashboard/expenses',
      group: 'Finance',
      submenu: [
        { name: 'My Expenses', path: '/dashboard/expenses' },
        { name: 'Approvals', path: '/dashboard/expenses/approvals' },
      ]
    },
    { name: 'Documents', icon: HiOutlineDocumentText, path: '/dashboard/documents', group: 'Resources' },
    { name: 'Assets', icon: HiOutlineCube, path: '/dashboard/assets', group: 'Resources' },
    { name: 'Policies', icon: HiOutlineBookOpen, path: '/dashboard/policies', group: 'Resources' },
    { name: 'Helpdesk', icon: HiOutlineLifebuoy, path: '/dashboard/helpdesk', group: 'Resources' },
    { name: 'Ideas', icon: HiOutlineLightBulb, path: '/dashboard/sandbox', group: 'Resources' },
    {
      name: 'Learning (LMS)',
      icon: HiOutlineAcademicCap,
      path: '/dashboard/learning',
      group: 'Resources',
      submenu: [
        { name: 'Courses', path: '/dashboard/learning/courses' },
        { name: 'My Trainings', path: '/dashboard/learning/trainings' },
        { name: 'Certificates', path: '/dashboard/learning/certificates' },
      ]
    },
    {
      name: 'Announcements',
      icon: HiOutlineMegaphone,
      path: '/dashboard/announcements',
      group: 'Company',
      submenu: [
        { name: 'All Announcements', path: '/dashboard/announcements' },
        { name: 'Create Announcement', path: '/dashboard/announcements/create' },
      ]
    },
    { name: 'Holidays', icon: HiOutlineCalendarDays, path: '/dashboard/holidays', group: 'Company' },
    { name: 'General Calendar', icon: HiOutlineCalendarDays, path: '/dashboard/calendar', group: 'Company' },
  ],

  // MANAGER - Team management focused
  manager: [
    { name: 'Dashboard', icon: HiOutlineSquares2X2, path: '/dashboard', group: 'Main' },
    { name: 'Chat', icon: HiOutlineChatBubbleLeftRight, path: '/dashboard/chat', group: 'Main' },
    { name: 'Mail', icon: HiOutlineEnvelope, path: '/dashboard/mail', group: 'Main' },
    { name: 'Meetings', icon: HiOutlineVideoCamera, path: '/dashboard/meetings', group: 'Main' },
    { name: "To-Do's", icon: HiOutlineListBullet, path: '/dashboard/todo', group: 'Main' },
    { name: 'TalioBoard', icon: HiOutlineRectangleGroup, path: '/dashboard/talioboard', group: 'Main' },
    {
      name: 'Projects',
      icon: HiOutlineClipboardDocumentList,
      path: '/dashboard/projects',
      group: 'Work',
      submenu: [
        { name: 'All Projects', path: '/dashboard/projects' },
        { name: 'My Tasks', path: '/dashboard/projects/my-tasks' },
        { name: 'Assigned Tasks', path: '/dashboard/projects/assigned-tasks' },
        { name: 'Pending Approvals', path: '/dashboard/projects/approvals' },
        { name: 'Create Project', path: '/dashboard/projects/create' },
      ]
    },
    {
      name: 'Attendance & Leaves',
      icon: HiOutlineClock,
      path: '/dashboard/attendance',
      group: 'Work',
      submenu: [
        { name: 'My Attendance', path: '/dashboard/attendance' },
        { name: 'Apply Leave', path: '/dashboard/leave/apply' },
        { name: 'My Leave Balance', path: '/dashboard/leave/balance' },
        { name: 'My Leave Requests', path: '/dashboard/leave/requests' },
        { name: 'Leave Approvals', path: '/dashboard/leave/approvals' },
      ]
    },
    { name: 'Payslips', icon: HiOutlineBanknotes, path: '/dashboard/payroll/payslips', group: 'Finance' },
    {
      name: 'Expenses',
      icon: HiOutlineReceiptPercent,
      path: '/dashboard/expenses',
      group: 'Finance',
      submenu: [
        { name: 'My Expenses', path: '/dashboard/expenses' },
        { name: 'Approvals', path: '/dashboard/expenses/approvals' },
      ]
    },
    { name: 'Documents', icon: HiOutlineDocumentText, path: '/dashboard/documents', group: 'Resources' },
    { name: 'Assets', icon: HiOutlineCube, path: '/dashboard/assets', group: 'Resources' },
    { name: 'Policies', icon: HiOutlineBookOpen, path: '/dashboard/policies', group: 'Resources' },
    {
      name: 'Learning',
      icon: HiOutlineAcademicCap,
      path: '/dashboard/learning',
      group: 'Resources',
      submenu: [
        { name: 'My Trainings', path: '/dashboard/learning/trainings' },
        { name: 'Certificates', path: '/dashboard/learning/certificates' },
      ]
    },
    { name: 'Announcements', icon: HiOutlineMegaphone, path: '/dashboard/announcements', group: 'Company' },
    { name: 'Helpdesk', icon: HiOutlineLifebuoy, path: '/dashboard/helpdesk', group: 'Resources' },
    { name: 'Ideas', icon: HiOutlineLightBulb, path: '/dashboard/sandbox', group: 'Resources' },
    { name: 'General Calendar', icon: HiOutlineCalendarDays, path: '/dashboard/calendar', group: 'Company' },
  ],

  // EMPLOYEE - Personal focused
  employee: [
    { name: 'Dashboard', icon: HiOutlineSquares2X2, path: '/dashboard', group: 'Main' },
    { name: 'Chat', icon: HiOutlineChatBubbleLeftRight, path: '/dashboard/chat', group: 'Main' },
    { name: 'Mail', icon: HiOutlineEnvelope, path: '/dashboard/mail', group: 'Main' },
    { name: 'Meetings', icon: HiOutlineVideoCamera, path: '/dashboard/meetings', group: 'Main' },
    { name: "To-Do's", icon: HiOutlineListBullet, path: '/dashboard/todo', group: 'Main' },
    { name: 'TalioBoard', icon: HiOutlineRectangleGroup, path: '/dashboard/talioboard', group: 'Main' },
    {
      name: 'Projects',
      icon: HiOutlineClipboardDocumentList,
      path: '/dashboard/projects',
      group: 'Work',
      submenu: [
        { name: 'My Projects', path: '/dashboard/projects' },
        { name: 'My Tasks', path: '/dashboard/projects/my-tasks' },
        { name: 'Assigned Tasks', path: '/dashboard/projects/assigned-tasks' },
        { name: 'Pending Approvals', path: '/dashboard/projects/approvals' },
        { name: 'Create Project', path: '/dashboard/projects/create' },
      ]
    },
    {
      name: 'Attendance & Leaves',
      icon: HiOutlineClock,
      path: '/dashboard/attendance',
      group: 'Work',
      submenu: [
        { name: 'My Attendance', path: '/dashboard/attendance' },
        { name: 'Apply Leave', path: '/dashboard/leave/apply' },
        { name: 'Leave Balance', path: '/dashboard/leave/balance' },
        { name: 'My Leave Requests', path: '/dashboard/leave/requests' },
      ]
    },
    { name: 'Payslips', icon: HiOutlineBanknotes, path: '/dashboard/payroll/payslips', group: 'Finance' },
    {
      name: 'Expenses',
      icon: HiOutlineReceiptPercent,
      path: '/dashboard/expenses',
      group: 'Finance',
      submenu: [
        { name: 'My Expenses', path: '/dashboard/expenses' },
        { name: 'Approvals', path: '/dashboard/expenses/approvals' },
      ]
    },
    { name: 'Documents', icon: HiOutlineDocumentText, path: '/dashboard/documents', group: 'Resources' },
    { name: 'Assets', icon: HiOutlineCube, path: '/dashboard/assets', group: 'Resources' },
    { name: 'Policies', icon: HiOutlineBookOpen, path: '/dashboard/policies', group: 'Resources' },
    {
      name: 'Learning',
      icon: HiOutlineAcademicCap,
      path: '/dashboard/learning',
      group: 'Resources',
      submenu: [
        { name: 'My Trainings', path: '/dashboard/learning/trainings' },
        { name: 'Certificates', path: '/dashboard/learning/certificates' },
      ]
    },
    { name: 'Announcements', icon: HiOutlineMegaphone, path: '/dashboard/announcements', group: 'Company' },
    { name: 'Helpdesk', icon: HiOutlineLifebuoy, path: '/dashboard/helpdesk', group: 'Resources' },
    { name: 'Ideas', icon: HiOutlineLightBulb, path: '/dashboard/sandbox', group: 'Resources' },
    { name: 'General Calendar', icon: HiOutlineCalendarDays, path: '/dashboard/calendar', group: 'Company' },
  ],

  // DEPARTMENT HEAD - Department management focused (inherits from manager with department oversight)
  department_head: [
    { name: 'Dashboard', icon: HiOutlineSquares2X2, path: '/dashboard', group: 'Main' },
    { name: 'Productivity', icon: HiOutlineComputerDesktop, path: '/dashboard/productivity', group: 'Main' },
    { name: 'Live Users', icon: HiOutlineSignal, path: '/dashboard/admin/live-users', group: 'Main' },
    { name: 'Chat', icon: HiOutlineChatBubbleLeftRight, path: '/dashboard/chat', group: 'Main' },
    { name: 'Mail', icon: HiOutlineEnvelope, path: '/dashboard/mail', group: 'Main' },
    { name: 'Meetings', icon: HiOutlineVideoCamera, path: '/dashboard/meetings', group: 'Main' },
    { name: "To-Do's", icon: HiOutlineListBullet, path: '/dashboard/todo', group: 'Main' },
    { name: 'TalioBoard', icon: HiOutlineRectangleGroup, path: '/dashboard/talioboard', group: 'Main' },
    {
      name: 'Projects',
      icon: HiOutlineClipboardDocumentList,
      path: '/dashboard/projects',
      group: 'Work',
      submenu: [
        { name: 'All Projects', path: '/dashboard/projects' },
        { name: 'My Tasks', path: '/dashboard/projects/my-tasks' },
        { name: 'Assigned Tasks', path: '/dashboard/projects/assigned-tasks' },
        { name: 'Pending Approvals', path: '/dashboard/projects/approvals' },
        { name: 'Create Project', path: '/dashboard/projects/create' },
      ]
    },
    {
      name: 'Attendance & Leaves',
      icon: HiOutlineClock,
      path: '/dashboard/attendance',
      group: 'Work',
      submenu: [
        { name: 'My Attendance', path: '/dashboard/attendance' },
        { name: 'Team Attendance', path: '/dashboard/attendance/team' },
        { name: 'Attendance Regularisation', path: '/dashboard/team/regularisation' },
        { name: 'Apply Leave', path: '/dashboard/leave/apply' },
        { name: 'My Leave Balance', path: '/dashboard/leave/balance' },
        { name: 'Leave Requests', path: '/dashboard/leave/requests' },
        { name: 'Leave Approvals', path: '/dashboard/leave/approvals' },
      ]
    },
    { name: 'Payslips', icon: HiOutlineBanknotes, path: '/dashboard/payroll/payslips', group: 'Finance' },
    {
      name: 'Expenses',
      icon: HiOutlineReceiptPercent,
      path: '/dashboard/expenses',
      group: 'Finance',
      submenu: [
        { name: 'My Expenses', path: '/dashboard/expenses' },
        { name: 'Approvals', path: '/dashboard/expenses/approvals' },
      ]
    },
    { name: 'Documents', icon: HiOutlineDocumentText, path: '/dashboard/documents', group: 'Resources' },
    { name: 'Assets', icon: HiOutlineCube, path: '/dashboard/assets', group: 'Resources' },
    { name: 'Policies', icon: HiOutlineBookOpen, path: '/dashboard/policies', group: 'Resources' },
    {
      name: 'Learning',
      icon: HiOutlineAcademicCap,
      path: '/dashboard/learning',
      group: 'Resources',
      submenu: [
        { name: 'My Trainings', path: '/dashboard/learning/trainings' },
        { name: 'Certificates', path: '/dashboard/learning/certificates' },
      ]
    },
    { name: 'Announcements', icon: HiOutlineMegaphone, path: '/dashboard/announcements', group: 'Company' },
    { name: 'Helpdesk', icon: HiOutlineLifebuoy, path: '/dashboard/helpdesk', group: 'Resources' },
    { name: 'Ideas', icon: HiOutlineLightBulb, path: '/dashboard/sandbox', group: 'Resources' },
    { name: 'General Calendar', icon: HiOutlineCalendarDays, path: '/dashboard/calendar', group: 'Company' },
  ],
}

// Helper function to get menu items based on user role
export const getMenuItemsForRole = (role) => {
  return roleBasedMenus[role] || roleBasedMenus.employee
}
