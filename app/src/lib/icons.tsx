// A curated set of Lucide icons that can be assigned to projects and
// workspaces. The chosen icon is stored as its name (a key of ICONS); the UI
// renders it through <ProjectIcon>. Keeping one shared list means the sidebar,
// dashboard, and picker always agree on what's available.

import {
  LayoutGrid,
  Boxes,
  Rocket,
  Sparkles,
  Gamepad2,
  Bot,
  Brain,
  Cpu,
  Database,
  Globe,
  Map,
  Compass,
  Calendar,
  CheckSquare,
  ListTodo,
  Music,
  Image,
  Camera,
  ShoppingCart,
  Coins,
  LineChart,
  Beaker,
  Leaf,
  Heart,
  type LucideIcon,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  "layout-grid": LayoutGrid,
  boxes: Boxes,
  rocket: Rocket,
  sparkles: Sparkles,
  "gamepad-2": Gamepad2,
  bot: Bot,
  brain: Brain,
  cpu: Cpu,
  database: Database,
  globe: Globe,
  map: Map,
  compass: Compass,
  calendar: Calendar,
  "check-square": CheckSquare,
  "list-todo": ListTodo,
  music: Music,
  image: Image,
  camera: Camera,
  "shopping-cart": ShoppingCart,
  coins: Coins,
  "line-chart": LineChart,
  beaker: Beaker,
  leaf: Leaf,
  heart: Heart,
};

export const DEFAULT_ICON = "layout-grid";

export const ICON_NAMES = Object.keys(ICONS);

/** Renders a curated icon by name, falling back to the default if unknown. */
export function ProjectIcon({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  const Icon = (name && ICONS[name]) || ICONS[DEFAULT_ICON];
  return <Icon className={className} />;
}
