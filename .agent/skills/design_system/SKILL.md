---
name: project_design_system
description: Reference for creating web interfaces based on the look & feel of ITBlue CRM.
---

# Modern Web Design System Skill

This skill serves as the ultimate reference for maintaining visual consistency across the project and for reuse in other projects. It defines the "Look & Feel" through specific Tailwind configurations, CSS patterns, and component structures.

## 🎨 Core Identity

### Typography
- **Primary Font**: `Inter`, sans-serif (Google Fonts).
- **Weights**: 300 (Light), 400 (Regular), 500 (Medium), 600 (Semi-bold), 700 (Bold).

### Color Palette (Tailwind-based)
- **Backgrounds**:
  - Main: `bg-slate-50` (#f8fafc)
  - Secondary: `bg-slate-100` (#f1f5f9)
  - Cards: `bg-white` (#ffffff)
- **Accents (Sky Blue)**:
  - Primary: `bg-sky-500` (#0ea5e9)
  - Hover/Active: `bg-sky-600` (#0284c7)
  - Light (Sidebar): `bg-sky-100` (#e0f2fe)
  - UI Accents: `sky-200`, `sky-300`
- **Text**:
  - Headings: `text-slate-800` (#1e293b)
  - Primary: `text-slate-700` (#334155)
  - Secondary/Muted: `text-slate-500` (#64748b)
- **Status/Alerts**:
  - Error/Cancel: `red-500`, `red-600`
  - Warning/Pending: `amber-500`, `amber-600`
  - Success/Win: `emerald-500`, `emerald-600`

## 🏗️ Structural Components

### 1. Sidebar (Persistent & Collapsible)
The sidebar is the main navigation anchor.
- **Background**: `bg-sky-100` with `border-r border-slate-200`.
- **Items**: Rounded-lg containers with hover effects (`hover:bg-sky-200`).
- **Active State**: `.active-link` (use `bg-sky-200/20` and `border-l-4 border-sky-500`).

### 2. Cards (The "Deal" Pattern)
Used for data display in grids or Kanban.
- **Classes**: `bg-white rounded-xl shadow-sm border border-slate-200 transition-all duration-200`.
- **Hover**: `hover:translate-y-[-2px] hover:shadow-md`.

### 3. Modals & Overlays
Centrally aligned with a dimming background.
- **Overlay**: `fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4`.
- **Content**: `bg-white rounded-xl shadow-2xl overflow-hidden`.
- **Header**: Sticky/Top with title and "close" icon (`text-slate-400 hover:text-slate-600`).

### 4. Forms & Inputs
- **Inputs**: `w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent`.
- **Primary Button**: `bg-sky-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-sky-700 transition-colors`.
- **Secondary Button**: `bg-white text-slate-600 border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors`.

## ✨ Micro-Interactions
- **Smooth Transitions**: Always use `transition-all duration-200` for hover effects.
- **Shadows**: Prefer elevation changes (`shadow-sm` to `shadow-md`) over color changes for interactive elements.
- **Wizard Steps**: Use a numeric indicator (`w-8 h-8 rounded-full`) with lines connecting them for multi-step processes.

## 📝 Best Practices
1. **Consistency**: Always use Tailwind's `slate` and `sky` families. Never introduce "web-safe" red/blue/green.
2. **Spacing**: Use consistent padding (`p-4`, `p-6`, `p-8`) to maintain the airy, premium feel.
3. **Icons**: Always use **Font Awesome 6**. Proportional sizing is key (usually `w-5` in menus).
4. **Empty States**: Use `animate-pulse` skeletons or clearly styled empty messages (`text-slate-400`).

## 🛠️ Usage Example (HTML Snippet)

```html
<!-- Example Card -->
<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 hover:shadow-md transition-all group">
    <div class="flex justify-between items-start mb-2">
        <h4 class="font-bold text-slate-800 group-hover:text-sky-600 transition-colors">Título de Ejemplo</h4>
        <span class="px-2 py-1 bg-sky-50 text-sky-700 text-xs rounded-full font-medium">Activo</span>
    </div>
    <p class="text-sm text-slate-500">Descripción breve para mantener la consistencia visual.</p>
</div>
```

---
*Refer to `.agent/skills/project_design_system/resources/` for detailed CSS variables and code snippets.*
