/** Board + task modal locators (DOM-confirmed). */
export const BOARD_SELECTORS = {
  category: ".project-category.category-draggable:not(.add)",
  categoryHeader: ".project-category__header",
  categoryBody: ".project-category-body",
  categoryName: ".project-category__text",
  taskCard: ".project-card:not(.project-card--add)",
  taskCardTitle: ".project-card__name, .project-card__text",
} as const;

export const TASK_MODAL_SELECTORS = {
  root: ".modal__content.modal-card.task-details, .modal-card.task-details",
  taskNumber: ".modal-card-header__number",
  createdAt: ".modal-card-header__date",
  title: ".modal-card-content__title",
  description: ".modal-card-content__textarea",
  aside: ".modal-card-body__aside.js-asideSettings",
  timeBlock: ".modal-card-time__item",
  timeValue: ".modal-card-time__value",
  tagChip: ".select-labels__item",
  memberOverlay: ".project-members--modal-card .parent-overlay",
  attachmentRow: ".modal-card-list__body .modal-card-list__item a",
  closeButton: ".modal.detailed-task .right-sidebar__close-btn, .modal-card-header button",
} as const;
