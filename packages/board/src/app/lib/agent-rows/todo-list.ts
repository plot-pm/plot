import { todoList, type DeliveryPlacement, type IssueAnswer, type TodoItem, type TodoList } from '@plot-pm/domain';
import type { DeliveryView } from './delivery-view.js';

/** The to-do list the Delivery tab renders: the domain's list over the same items the You section renders. */
export const todoListOf = (view: DeliveryView, placement: DeliveryPlacement, ticketAnswer: IssueAnswer | null): TodoList => {
  const items: TodoItem[] = view.sections.flatMap((s) =>
    s.groups.flatMap((g) => g.items.flatMap((i) => (i.placement === null ? [] : [{ placement: i.placement, label: i.label, anchor: i.anchor }]))));
  return todoList({ items, ticketAnswer, tickets: placement.tickets });
};
