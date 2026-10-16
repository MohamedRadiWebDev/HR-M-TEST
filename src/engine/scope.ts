import { normalizeEmpCode, parseRuleScope } from "@shared/rule-scope";
import type { Employee, SpecialRule } from "@shared/schema";

/** True when `rule` applies to the employee (supports comma / Arabic-comma separated lists). */
export const ruleAppliesToEmployee = (rule: SpecialRule, employee: Employee): boolean =>
  scopeAppliesToEmployee(rule.scope, employee);

export const scopeAppliesToEmployee = (scope: string, employee: Employee): boolean => {
  if (!scope || scope === "all") return true;
  const parsed = parseRuleScope(scope);
  if (parsed.type === "emp") return parsed.values.includes(normalizeEmpCode(String(employee.code ?? "")));
  if (parsed.type === "dept") return parsed.values.includes(String(employee.department ?? "").trim());
  if (parsed.type === "sector") return parsed.values.includes(String(employee.sector ?? "").trim());
  return false; // unknown prefix never matches (previously risked matching everyone)
};

