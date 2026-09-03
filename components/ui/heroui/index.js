'use client'

/**
 * Hero UI Component Library for HRMS
 * Centralized exports for all Hero UI components used in the application
 * This ensures consistent usage and easy maintenance
 */

// ============================================
// HRMS Custom Components (Built on Hero UI)
// ============================================

// Cards
export {
  HRMSCard,
  HRMSCardHeader,
  HRMSCardBody,
  HRMSCardFooter,
  KPICard,
  WidgetCard,
} from './Card'

// Buttons
export {
  HRMSButton,
  PrimaryButton,
  SecondaryButton,
  DangerButton,
  SuccessButton,
  GhostButton,
  IconButton,
} from './Button'

// Form Inputs
export {
  HRMSInput,
  HRMSTextarea,
  HRMSSelect,
  HRMSSelectItem,
  HRMSCheckbox,
  HRMSSwitch,
  HRMSRadio,
  HRMSRadioGroup,
  SearchInput,
} from './Input'

export { default as SearchableSelect } from './SearchableSelect'

// Tables
export {
  HRMSTable,
  PaginatedTable,
  SimpleTable,
  SimpleTableHead,
  SimpleTableBody,
  SimpleTableRow,
  SimpleTableCell,
} from './Table'

// Modals
export {
  HRMSModal,
  HRMSModalContent,
  HRMSModalHeader,
  HRMSModalBody,
  HRMSModalFooter,
  ConfirmModal,
  AlertModal,
  useDisclosure,
} from './Modal'

// Badges & Chips
export {
  StatusBadge,
  HRMSChip,
  CountBadge,
  PriorityBadge,
  RoleBadge,
  HRMSAvatar,
} from './Badge'

// Loading States
export {
  PageLoader,
  SectionLoader,
  InlineLoader,
  ButtonLoader,
  CardSkeleton,
  TableSkeleton,
  KPISkeleton,
  DashboardSkeleton,
  ListSkeleton,
  FormSkeleton,
  ProgressBar,
  CircularProgressBar,
} from './Loading'

// Empty & Error States
export {
  EmptyState,
  NoResults,
  ErrorState,
  NetworkError,
  PermissionDenied,
  ComingSoon,
} from './States'

// ============================================
// Re-export Hero UI Core Components
// ============================================
export {
  // Layout & Container
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Divider,
  Spacer,
  
  // Buttons
  Button,
  ButtonGroup,
  
  // Form Elements
  Input,
  Textarea,
  Select,
  SelectItem,
  Checkbox,
  CheckboxGroup,
  Radio,
  RadioGroup,
  Switch,
  Slider,
  
  // Data Display
  Avatar,
  AvatarGroup,
  Badge,
  Chip,
  User,
  Code,
  Snippet,
  
  // Feedback
  Progress,
  CircularProgress,
  Spinner,
  Skeleton,
  
  // Overlays
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Tooltip,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownSection,
  
  // Navigation
  Tabs,
  Tab,
  Breadcrumbs,
  BreadcrumbItem,
  Link,
  Pagination,
  
  // Data Entry
  Table,
  TableHeader,
  TableBody,
  TableColumn,
  TableRow,
  TableCell,
  
  // Disclosure
  Accordion,
  AccordionItem,
  
  // Media
  Image,
  
  // Date & Time
  Calendar,
  DatePicker,
  DateRangePicker,
  TimeInput,
  
  // Utilities
  ScrollShadow,
  Listbox,
  ListboxItem,
  ListboxSection,
  Autocomplete,
  AutocompleteItem,
  AutocompleteSection,
} from '@heroui/react'
