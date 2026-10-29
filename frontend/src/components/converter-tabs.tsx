import { Link } from "@tanstack/react-router";
import { CreditCard, Landmark, ReceiptText } from "lucide-react";

const tabs = [
  { to: "/dashboard", label: "Bank Statement", icon: Landmark },
  { to: "/credit-card", label: "Credit Card", icon: CreditCard },
  { to: "/invoice", label: "Invoices / Receipts", icon: ReceiptText },
] as const;

export function ConverterTabs() {
  return (
    <nav aria-label="Converter" className="inline-flex gap-1 rounded-lg bg-muted p-1">
      {tabs.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          activeProps={{ className: "bg-primary text-primary-foreground shadow hover:text-primary-foreground" }}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
