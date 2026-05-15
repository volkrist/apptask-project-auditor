/** Reference to a task card on the board (re-open via DOM). */
export type TaskRef = {
  categoryId: string;
  categoryName: string | null;
  columnStateId: string | null;
  taskId: string | null;
  titlePreview: string | null;
};
