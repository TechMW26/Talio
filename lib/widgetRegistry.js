/**
 * Widget Registry - Defines all available widgets for the customizable dashboard
 * Each widget has metadata and a component factory function
 */

import {
  FaUsers, FaClock, FaCalendarAlt, FaMoneyBillWave,
  FaChartLine, FaBriefcase, FaBuilding, FaExclamationTriangle,
  FaTasks, FaBullseye, FaClipboardList, FaUserClock,
  FaFileAlt, FaChartBar, FaChartPie, FaUserCheck,
  FaPlane, FaReceipt, FaHeadset, FaLaptop, FaBell,
  FaEnvelope, FaComments, FaProjectDiagram, FaUserTie,
  FaCheckCircle, FaHourglassHalf, FaExclamationCircle, FaNewspaper
} from 'react-icons/fa'

// Widget Categories
export const WIDGET_CATEGORIES = {
  ATTENDANCE: 'attendance',
  EMPLOYEES: 'employees',
  LEAVE: 'leave',
  PAYROLL: 'payroll',
  PERFORMANCE: 'performance',
  PROJECTS: 'projects',
  QUICK_ACCESS: 'quick_access',
  ANALYTICS: 'analytics',
  NOTIFICATIONS: 'notifications',
}

// Widget Sizes
export const WIDGET_SIZES = {
  SMALL: 'small',      // 1 column
  MEDIUM: 'medium',    // 2 columns
  LARGE: 'large',      // 3 columns (full width)
  HALF: 'half',        // Half width
  FULL: 'full',        // Full width
}

// All available widgets definition
export const WIDGET_REGISTRY = {
  // ============ ATTENDANCE WIDGETS ============
  'check-in-out': {
    id: 'check-in-out',
    name: 'Check In/Out',
    description: 'Clock in and out for daily attendance tracking',
    category: WIDGET_CATEGORIES.ATTENDANCE,
    icon: FaClock,
    size: WIDGET_SIZES.FULL,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 1,
  },
  'quick-glance': {
    id: 'quick-glance',
    name: 'Quick Glance',
    description: 'View today\'s check-in/out times and work status',
    category: WIDGET_CATEGORIES.ATTENDANCE,
    icon: FaUserClock,
    size: WIDGET_SIZES.FULL,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 2,
  },
  'attendance-summary': {
    id: 'attendance-summary',
    name: 'Attendance Summary',
    description: 'Monthly attendance overview with present/absent days',
    category: WIDGET_CATEGORIES.ATTENDANCE,
    icon: FaCalendarAlt,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 3,
  },
  'team-attendance': {
    id: 'team-attendance',
    name: 'Team Attendance',
    description: 'View your team\'s attendance status for today',
    category: WIDGET_CATEGORIES.ATTENDANCE,
    icon: FaUsers,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager'],
    order: 4,
  },

  // ============ EMPLOYEE WIDGETS ============
  'kpi-stats': {
    id: 'kpi-stats',
    name: 'KPI Statistics',
    description: 'Key performance indicators - employees, departments, leaves',
    category: WIDGET_CATEGORIES.EMPLOYEES,
    icon: FaChartLine,
    size: WIDGET_SIZES.FULL,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager'],
    order: 5,
  },
  'employee-directory': {
    id: 'employee-directory',
    name: 'Employee Directory',
    description: 'Quick access to employee list and search',
    category: WIDGET_CATEGORIES.EMPLOYEES,
    icon: FaUsers,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager'],
    order: 6,
  },
  'new-employees': {
    id: 'new-employees',
    name: 'New Employees',
    description: 'Recently joined employees this month',
    category: WIDGET_CATEGORIES.EMPLOYEES,
    icon: FaUserTie,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: false,
    roles: ['admin', 'hr'],
    order: 7,
  },
  'birthday-widget': {
    id: 'birthday-widget',
    name: 'Birthdays',
    description: 'Upcoming employee birthdays',
    category: WIDGET_CATEGORIES.EMPLOYEES,
    icon: FaBullseye,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 8,
  },
  'work-anniversary': {
    id: 'work-anniversary',
    name: 'Work Anniversaries',
    description: 'Upcoming work anniversaries',
    category: WIDGET_CATEGORIES.EMPLOYEES,
    icon: FaCheckCircle,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 9,
  },

  // ============ LEAVE WIDGETS ============
  'leave-requests': {
    id: 'leave-requests',
    name: 'Recent Leave Requests',
    description: 'View and manage recent leave requests',
    category: WIDGET_CATEGORIES.LEAVE,
    icon: FaCalendarAlt,
    size: WIDGET_SIZES.HALF,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager'],
    order: 10,
  },
  'leave-balance': {
    id: 'leave-balance',
    name: 'Leave Balance',
    description: 'Your remaining leave balance by type',
    category: WIDGET_CATEGORIES.LEAVE,
    icon: FaHourglassHalf,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 11,
  },
  'pending-approvals': {
    id: 'pending-approvals',
    name: 'Pending Approvals',
    description: 'Leave requests awaiting your approval',
    category: WIDGET_CATEGORIES.LEAVE,
    icon: FaExclamationCircle,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager'],
    order: 12,
  },
  'team-calendar': {
    id: 'team-calendar',
    name: 'Team Calendar',
    description: 'Team leave and holiday calendar view',
    category: WIDGET_CATEGORIES.LEAVE,
    icon: FaCalendarAlt,
    size: WIDGET_SIZES.LARGE,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager'],
    order: 13,
  },

  // ============ PAYROLL WIDGETS ============
  'payroll-summary': {
    id: 'payroll-summary',
    name: 'Payroll Summary',
    description: 'Monthly payroll overview and statistics',
    category: WIDGET_CATEGORIES.PAYROLL,
    icon: FaMoneyBillWave,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr'],
    order: 14,
  },
  'salary-slip': {
    id: 'salary-slip',
    name: 'My Salary Slip',
    description: 'Quick access to your latest salary slip',
    category: WIDGET_CATEGORIES.PAYROLL,
    icon: FaFileAlt,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 15,
  },
  'expense-claims': {
    id: 'expense-claims',
    name: 'Expense Claims',
    description: 'Recent expense claims and reimbursements',
    category: WIDGET_CATEGORIES.PAYROLL,
    icon: FaReceipt,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 16,
  },

  // ============ PERFORMANCE WIDGETS ============
  'goals-widget': {
    id: 'goals-widget',
    name: 'My Goals',
    description: 'Track your performance goals and progress',
    category: WIDGET_CATEGORIES.PERFORMANCE,
    icon: FaBullseye,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 17,
  },
  'team-performance': {
    id: 'team-performance',
    name: 'Team Performance',
    description: 'Overview of team performance metrics',
    category: WIDGET_CATEGORIES.PERFORMANCE,
    icon: FaChartBar,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager'],
    order: 18,
  },
  'reviews-pending': {
    id: 'reviews-pending',
    name: 'Pending Reviews',
    description: 'Performance reviews awaiting completion',
    category: WIDGET_CATEGORIES.PERFORMANCE,
    icon: FaClipboardList,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager'],
    order: 19,
  },

  // ============ PROJECT WIDGETS ============
  'project-tasks': {
    id: 'project-tasks',
    name: 'Project Tasks',
    description: 'Your assigned tasks and project updates',
    category: WIDGET_CATEGORIES.PROJECTS,
    icon: FaTasks,
    size: WIDGET_SIZES.HALF,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 20,
  },
  'active-projects': {
    id: 'active-projects',
    name: 'Active Projects',
    description: 'List of currently active projects',
    category: WIDGET_CATEGORIES.PROJECTS,
    icon: FaProjectDiagram,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 21,
  },
  'project-timeline': {
    id: 'project-timeline',
    name: 'Project Timeline',
    description: 'Visual timeline of project milestones',
    category: WIDGET_CATEGORIES.PROJECTS,
    icon: FaChartLine,
    size: WIDGET_SIZES.LARGE,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager'],
    order: 22,
  },

  // ============ ANALYTICS WIDGETS ============
  'department-distribution': {
    id: 'department-distribution',
    name: 'Department Distribution',
    description: 'Employee distribution across departments',
    category: WIDGET_CATEGORIES.ANALYTICS,
    icon: FaChartPie,
    size: WIDGET_SIZES.HALF,
    defaultEnabled: true,
    roles: ['admin', 'hr'],
    order: 23,
  },
  'attendance-chart': {
    id: 'attendance-chart',
    name: 'Attendance Chart',
    description: 'Weekly/Monthly attendance trends',
    category: WIDGET_CATEGORIES.ANALYTICS,
    icon: FaChartBar,
    size: WIDGET_SIZES.HALF,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager'],
    order: 24,
  },
  'headcount-trend': {
    id: 'headcount-trend',
    name: 'Headcount Trend',
    description: 'Employee headcount over time',
    category: WIDGET_CATEGORIES.ANALYTICS,
    icon: FaChartLine,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr'],
    order: 25,
  },

  // ============ QUICK ACCESS WIDGETS ============
  'quick-actions': {
    id: 'quick-actions',
    name: 'Quick Actions',
    description: 'Shortcuts to common actions',
    category: WIDGET_CATEGORIES.QUICK_ACCESS,
    icon: FaBriefcase,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 26,
  },
  'recent-activities': {
    id: 'recent-activities',
    name: 'Recent Activities',
    description: 'Your recent activities and actions',
    category: WIDGET_CATEGORIES.QUICK_ACCESS,
    icon: FaClock,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 27,
  },
  'bookmarks': {
    id: 'bookmarks',
    name: 'Bookmarks',
    description: 'Quick links to your bookmarked pages',
    category: WIDGET_CATEGORIES.QUICK_ACCESS,
    icon: FaFileAlt,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 28,
  },

  // ============ NOTIFICATION WIDGETS ============
  'announcements': {
    id: 'announcements',
    name: 'Announcements',
    description: 'Company-wide announcements and news',
    category: WIDGET_CATEGORIES.NOTIFICATIONS,
    icon: FaBell,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 29,
  },
  'notifications-feed': {
    id: 'notifications-feed',
    name: 'Notifications',
    description: 'Your recent notifications',
    category: WIDGET_CATEGORIES.NOTIFICATIONS,
    icon: FaBell,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 30,
  },

  // ============ SPECIAL WIDGETS ============
  'helpdesk-tickets': {
    id: 'helpdesk-tickets',
    name: 'Helpdesk Tickets',
    description: 'Recent helpdesk tickets and their status',
    category: WIDGET_CATEGORIES.QUICK_ACCESS,
    icon: FaHeadset,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 31,
  },
  'travel-requests': {
    id: 'travel-requests',
    name: 'Travel Requests',
    description: 'Pending and recent travel requests',
    category: WIDGET_CATEGORIES.QUICK_ACCESS,
    icon: FaPlane,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 32,
  },
  'assets': {
    id: 'assets',
    name: 'My Assets',
    description: 'Assets assigned to you',
    category: WIDGET_CATEGORIES.QUICK_ACCESS,
    icon: FaLaptop,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 33,
  },

  // ============ NEW EMPLOYEE-FOCUSED WIDGETS ============
  'holidays': {
    id: 'holidays',
    name: 'Upcoming Holidays',
    description: 'View upcoming company holidays',
    category: WIDGET_CATEGORIES.LEAVE,
    icon: FaCalendarAlt,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 34,
  },
  'today-tasks': {
    id: 'today-tasks',
    name: "Today's Tasks",
    description: 'Tasks due today and your daily to-dos',
    category: WIDGET_CATEGORIES.PROJECTS,
    icon: FaTasks,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 35,
  },
  'learning-progress': {
    id: 'learning-progress',
    name: 'Learning Progress',
    description: 'Track your course and training progress',
    category: WIDGET_CATEGORIES.PERFORMANCE,
    icon: FaChartLine,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: false,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 36,
  },
  'recent-activity': {
    id: 'recent-activity',
    name: 'Recent Activity',
    description: 'Your recent clock-ins, breaks, and activities',
    category: WIDGET_CATEGORIES.ATTENDANCE,
    icon: FaClock,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 37,
  },

  // ============ NEW REQUESTED WIDGETS ============
  'my-assets': {
    id: 'my-assets',
    name: 'My Assets',
    description: 'View your assigned assets',
    category: WIDGET_CATEGORIES.QUICK_ACCESS,
    icon: FaLaptop,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 38,
  },
  'my-expenses': {
    id: 'my-expenses',
    name: 'My Expenses',
    description: 'Track your expenses and claims',
    category: WIDGET_CATEGORIES.PAYROLL,
    icon: FaReceipt,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 39,
  },
  'my-helpdesk': {
    id: 'my-helpdesk',
    name: 'Helpdesk',
    description: 'Submit and track helpdesk tickets',
    category: WIDGET_CATEGORIES.QUICK_ACCESS,
    icon: FaHeadset,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 40,
  },
  'policies': {
    id: 'policies',
    name: 'Company Policies',
    description: 'View important company policies',
    category: WIDGET_CATEGORIES.QUICK_ACCESS,
    icon: FaFileAlt,
    size: WIDGET_SIZES.SMALL,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee'],
    order: 41,
  },
  'role-news': {
    id: 'role-news',
    name: 'Latest Role News',
    description: 'Real-time market news and updates based on your role and designation',
    category: WIDGET_CATEGORIES.NOTIFICATIONS,
    icon: FaNewspaper,
    size: WIDGET_SIZES.MEDIUM,
    defaultEnabled: true,
    roles: ['admin', 'hr', 'manager', 'employee', 'department_head'],
    order: 30, // Positioned right after announcements (order: 29)
  },
}

// Get widgets available for a specific role
export function getWidgetsForRole(role) {
  return Object.values(WIDGET_REGISTRY).filter(widget =>
    widget.roles.includes(role)
  ).sort((a, b) => a.order - b.order)
}

// Get default enabled widgets for a role
export function getDefaultWidgetsForRole(role) {
  return Object.values(WIDGET_REGISTRY).filter(widget =>
    widget.roles.includes(role) && widget.defaultEnabled
  ).sort((a, b) => a.order - b.order)
}

// Get widgets by category
export function getWidgetsByCategory(category, role = null) {
  let widgets = Object.values(WIDGET_REGISTRY).filter(widget =>
    widget.category === category
  )

  if (role) {
    widgets = widgets.filter(widget => widget.roles.includes(role))
  }

  return widgets.sort((a, b) => a.order - b.order)
}

// Get all categories with their widgets
export function getCategorizedWidgets(role = null) {
  const categories = {}

  Object.values(WIDGET_CATEGORIES).forEach(category => {
    const widgets = getWidgetsByCategory(category, role)
    if (widgets.length > 0) {
      categories[category] = {
        name: getCategoryDisplayName(category),
        widgets
      }
    }
  })

  return categories
}

// Get display name for category
export function getCategoryDisplayName(category) {
  const names = {
    [WIDGET_CATEGORIES.ATTENDANCE]: 'Attendance',
    [WIDGET_CATEGORIES.EMPLOYEES]: 'Employees',
    [WIDGET_CATEGORIES.LEAVE]: 'Leave Management',
    [WIDGET_CATEGORIES.PAYROLL]: 'Payroll',
    [WIDGET_CATEGORIES.PERFORMANCE]: 'Performance',
    [WIDGET_CATEGORIES.PROJECTS]: 'Projects & Tasks',
    [WIDGET_CATEGORIES.QUICK_ACCESS]: 'Quick Access',
    [WIDGET_CATEGORIES.ANALYTICS]: 'Analytics & Charts',
    [WIDGET_CATEGORIES.NOTIFICATIONS]: 'Notifications',
  }
  return names[category] || category
}

export default WIDGET_REGISTRY
