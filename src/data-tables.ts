import { EraError, integer, text, type Value } from "./model.js";

const COLUMN_TYPES = ["int8", "int16", "int32", "int64", "string"] as const;
interface Column { type: typeof COLUMN_TYPES[number]; nullable: boolean }
interface Row { id: bigint; cells: Map<string, Value> }
interface Table { columns: Map<string, Column>; rows: Row[] }
export interface TableResult { value: Value; selected?: bigint[] }

export const TABLE_OPERATIONS = new Set([
  "DT_CREATE", "DT_EXIST", "DT_RELEASE", "DT_CLEAR", "DT_COLUMN_ADD",
  "DT_ROW_ADD", "DT_ROW_LENGTH", "DT_COLUMN_LENGTH", "DT_CELL_GET",
  "DT_CELL_GETS", "DT_CELL_ISNULL", "DT_CELL_SET", "DT_SELECT",
]);

/**
 * Session-local subset of Emuera's DataTable extension. Row IDs are opaque,
 * positive identifiers, distinct from zero-based row positions. They remain
 * stable across selection and clearing, and are never reused in this runtime.
 * The native engine uses time-derived IDs; scripts must treat these as opaque.
 * Unsupported schema types and filter syntax fail rather than approximating SQL.
 */
export class DataTables {
  private tables = new Map<string, Table>();
  private nextId = 1n;

  execute(op: string, args: (Value | undefined)[]): TableResult {
    const arities: Record<string, [number, number]> = {
      DT_CREATE: [1, 1], DT_EXIST: [1, 1], DT_RELEASE: [1, 1], DT_CLEAR: [1, 1],
      DT_COLUMN_ADD: [2, 4], DT_ROW_ADD: [1, 10000], DT_ROW_LENGTH: [1, 1],
      DT_COLUMN_LENGTH: [1, 1], DT_CELL_GET: [3, 4], DT_CELL_GETS: [3, 4],
      DT_CELL_ISNULL: [3, 4], DT_CELL_SET: [3, 5], DT_SELECT: [1, 2],
    };
    const arity = arities[op];
    if (!arity || args.length < arity[0] || args.length > arity[1]) throw new EraError(`Unsupported arguments for ${op}`);
    const required = (i: number): Value => {
      const value = args[i];
      if (value === undefined) throw new EraError(`Missing argument ${i + 1} for ${op}`);
      return value;
    };
    const s = (i: number): string => text(required(i));
    const n = (i: number): bigint => integer(required(i));
    const result = (value: Value): TableResult => ({ value });
    const name = s(0);
    const table = this.tables.get(name);
    if (op === "DT_RELEASE") { this.tables.delete(name); return result(1n); }
    if (op === "DT_EXIST") return result(table ? 1n : 0n);
    if (op === "DT_CREATE") {
      if (table) return result(0n);
      this.tables.set(name, { columns: new Map([["id", { type: "int64", nullable: false }]]), rows: [] });
      return result(1n);
    }
    if (!table) return result(op === "DT_CELL_GETS" ? "" : op === "DT_CELL_GET" ? 0n : -1n);
    switch (op) {
      case "DT_CLEAR": table.rows = []; return result(1n);
      case "DT_ROW_LENGTH": return result(BigInt(table.rows.length));
      case "DT_COLUMN_LENGTH": return result(BigInt(table.columns.size));
      case "DT_COLUMN_ADD": {
        const columnName = s(1);
        if (table.columns.has(columnName)) return result(0n);
        const requested = args[2] ?? "string";
        const type = COLUMN_TYPES.find((type, i) => typeof requested === "bigint" ? requested === BigInt(i + 1) : requested === type);
        if (!type) throw new EraError(`Unsupported data-table column type: ${requested}`);
        const nullable = args[3] === undefined || n(3) !== 0n;
        if (!nullable && table.rows.length) throw new EraError("Cannot add a non-nullable column to a populated data table");
        table.columns.set(columnName, { type, nullable });
        return result(1n);
      }
      case "DT_ROW_ADD": {
        if (args.length % 2 !== 1) throw new EraError("DT_ROW_ADD expects table followed by column/value pairs");
        const row: Row = { id: this.nextId, cells: new Map() };
        for (let i = 1; i < args.length; i += 2) {
          const name = s(i);
          const column = table.columns.get(name);
          if (name.toLowerCase() === "id") throw new EraError("Cannot assign data-table id column");
          if (!column) throw new EraError(`Unknown data-table column: ${name}`);
          const value = this.convert(args[i + 1], column);
          if (value !== undefined) row.cells.set(name, value);
        }
        for (const [name, column] of table.columns) {
          if (name !== "id" && !column.nullable && !row.cells.has(name)) throw new EraError(`Data-table column cannot be null: ${name}`);
        }
        this.nextId++;
        table.rows.push(row);
        return result(row.id);
      }
      case "DT_SELECT": {
        const filter = args[1] === undefined ? "" : s(1).trim();
        let predicate = (_row: Row): boolean => true;
        if (filter) {
          // The game's achievement lookups use DataColumn-expression equality,
          // not arbitrary SQL. Doubled quotes escape apostrophes in literals.
          const match = /^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(?:'((?:[^']|'')*)'|([+-]?\d+))$/.exec(filter);
          if (!match) throw new EraError(`Unsupported DT_SELECT filter: ${filter}`);
          const name = match[1]!;
          const column = table.columns.get(name);
          if (!column) throw new EraError(`Unknown data-table column: ${name}`);
          const value = match[2] !== undefined ? match[2].replace(/''/g, "'") : BigInt(match[3]!);
          if ((typeof value === "string") !== (column.type === "string")) throw new EraError("DT_SELECT filter type does not match column");
          predicate = (row) => (name === "id" ? row.id : row.cells.get(name)) === value;
        }
        const selected = table.rows.filter(predicate).map((row) => row.id);
        return { value: BigInt(selected.length), selected };
      }
      default: {
        const asIdIndex = op === "DT_CELL_SET" ? 4 : 3;
        const index = n(1);
        const asId = args[asIdIndex] !== undefined && n(asIdIndex) !== 0n;
        const row = asId ? table.rows.find((row) => row.id === index) : index >= 0n && index < BigInt(table.rows.length) ? table.rows[Number(index)] : undefined;
        const name = s(2);
        const column = table.columns.get(name);
        if (op === "DT_CELL_SET") {
          if (name.toLowerCase() === "id") return result(0n);
          if (!row || !column) return result(-3n);
          if (args[3] !== undefined && (typeof args[3] === "string") !== (column.type === "string")) return result(-2n);
          const value = this.convert(args[3], column);
          if (value === undefined) row.cells.delete(name);
          else row.cells.set(name, value);
          return result(1n);
        }
        if (!row || !column) return result(op === "DT_CELL_GETS" ? "" : op === "DT_CELL_ISNULL" ? -2n : 0n);
        const value = name === "id" ? row.id : row.cells.get(name);
        if (op === "DT_CELL_ISNULL") return result(value === undefined ? 1n : 0n);
        if (op === "DT_CELL_GETS") return result(value?.toString() ?? "");
        if (value === undefined) return result(0n);
        if (typeof value === "bigint") return result(value);
        if (!/^[+-]?\d+$/.test(value)) throw new EraError(`Data-table cell is not an integer: ${value}`);
        const parsed = BigInt(value);
        if (parsed !== BigInt.asIntN(64, parsed)) throw new EraError("Data-table cell integer out of range");
        return result(parsed);
      }
    }
  }

  private convert(value: Value | undefined, column: Column): Value | undefined {
    if (value === undefined) {
      if (!column.nullable) throw new EraError("Data-table column cannot be null");
      return undefined;
    }
    if (column.type === "string") return text(value);
    const numeric = integer(value);
    const bits = column.type === "int8" ? 8 : column.type === "int16" ? 16 : column.type === "int32" ? 32 : 64;
    const max = (1n << BigInt(bits - 1)) - 1n;
    const min = -max - 1n;
    return numeric < min ? min : numeric > max ? max : numeric;
  }
}
