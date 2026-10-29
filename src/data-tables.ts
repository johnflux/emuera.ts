import type { Document, Element } from "@xmldom/xmldom";
import { EraError, integer, text, type Value } from "./model.js";
import { parseXml } from "./xml.js";
import { compareCells, compileFilter, parseSort, type Cell, type RowReader } from "./data-expression.js";

const COLUMN_TYPES = ["int8", "int16", "int32", "int64", "string"] as const;
const XSD_TYPES: Record<typeof COLUMN_TYPES[number], string> = { int8: "xs:byte", int16: "xs:short", int32: "xs:int", int64: "xs:long", string: "xs:string" };
interface Column { type: typeof COLUMN_TYPES[number]; nullable: boolean; default?: Value | undefined }
interface Row { id: bigint; cells: Map<string, Value> }
interface Table { name: string; columns: Map<string, Column>; rows: Row[]; caseSensitive?: boolean }
/** `schema` is DT_TOXML's schema output; `names` is DT_COLUMN_NAMES's array output. */
export interface TableResult { value: Value; selected?: bigint[]; schema?: string; names?: string[] }

export const TABLE_OPERATIONS = new Set([
  "DT_CREATE", "DT_EXIST", "DT_RELEASE", "DT_CLEAR", "DT_COLUMN_ADD",
  "DT_ROW_ADD", "DT_ROW_LENGTH", "DT_COLUMN_LENGTH", "DT_CELL_GET",
  "DT_CELL_GETS", "DT_CELL_ISNULL", "DT_CELL_SET", "DT_SELECT",
  "DT_ROW_SET", "DT_ROW_REMOVE", "DT_COLUMN_EXIST", "DT_COLUMN_REMOVE",
  "DT_COLUMN_OPTIONS", "DT_COLUMN_NAMES", "DT_TOXML", "DT_FROMXML", "DT_NOCASE",
]);
const escape = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");


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
  private filters = new Map<string, (row: RowReader) => boolean>();

  clear(): void { this.tables.clear(); }
  /** VarExt reset: an existing table keeps its schema but loses its rows. */
  clearRows(name: string): void { const table = this.tables.get(name); if (table) table.rows = []; }
  export(name: string): [schema: string, data: string] | undefined {
    const table = this.tables.get(name);
    return table && [this.schemaXml(table), this.dataXml(table)];
  }
  import(name: string, [schema, data]: [string, string]): void {
    const loaded = this.fromXml(schema, data);
    if (loaded) this.tables.set(name, { ...loaded, name });
  }

  execute(op: string, args: (Value | undefined)[]): TableResult {
    const arities: Record<string, [number, number]> = {
      DT_CREATE: [1, 1], DT_EXIST: [1, 1], DT_RELEASE: [1, 1], DT_CLEAR: [1, 1], DT_NOCASE: [2, 2],
      DT_COLUMN_ADD: [2, 4], DT_ROW_ADD: [1, 10000], DT_ROW_LENGTH: [1, 1],
      DT_COLUMN_LENGTH: [1, 1], DT_CELL_GET: [3, 4], DT_CELL_GETS: [3, 4],
      DT_CELL_ISNULL: [3, 4], DT_CELL_SET: [3, 5], DT_SELECT: [1, 4],
      DT_ROW_SET: [2, 10000], DT_ROW_REMOVE: [2, 2], DT_COLUMN_EXIST: [2, 2], DT_COLUMN_REMOVE: [2, 2],
      DT_COLUMN_OPTIONS: [4, 10000], DT_COLUMN_NAMES: [1, 2], DT_TOXML: [1, 2], DT_FROMXML: [3, 3],
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
      this.tables.set(name, { name, columns: new Map([["id", { type: "int64", nullable: false }]]), rows: [], caseSensitive: true });
      return result(1n);
    }
    if (op === "DT_FROMXML") {
      const loaded = this.fromXml(s(1), s(2));
      if (!loaded) return result(0n);
      this.tables.set(name, loaded);
      return result(1n);
    }
    if (!table) return result(op === "DT_CELL_GETS" || op === "DT_TOXML" ? "" : op === "DT_CELL_GET" || op === "DT_COLUMN_EXIST" ? 0n : -1n);
    switch (op) {
      case "DT_NOCASE": table.caseSensitive = n(1) === 0n; return result(1n);
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
      case "DT_COLUMN_EXIST": {
        const column = table.columns.get(s(1));
        return result(column ? BigInt(COLUMN_TYPES.indexOf(column.type) + 1) : 0n);
      }
      case "DT_COLUMN_REMOVE": {
        const columnName = s(1);
        if (columnName.toLowerCase() === "id" || !table.columns.delete(columnName)) return result(0n);
        for (const row of table.rows) row.cells.delete(columnName);
        return result(1n);
      }
      case "DT_COLUMN_NAMES": {
        const names = [...table.columns.keys()];
        return { value: BigInt(names.length), names };
      }
      case "DT_COLUMN_OPTIONS": {
        const column = table.columns.get(s(1));
        if (!column) return result(0n);
        if (args.length % 2 !== 0) throw new EraError("DT_COLUMN_OPTIONS expects option/value pairs");
        for (let i = 2; i < args.length; i += 2) {
          const option = s(i).toUpperCase();
          if (option !== "DEFAULT") throw new EraError(`Unsupported DT_COLUMN_OPTIONS option: ${option}`);
          column.default = args[i + 1] === undefined ? undefined : this.convert(args[i + 1], column);
        }
        return result(1n);
      }
      case "DT_ROW_REMOVE": {
        const index = table.rows.findIndex((row) => row.id === n(1));
        if (index < 0) return result(0n);
        table.rows.splice(index, 1);
        return result(1n);
      }
      case "DT_ROW_SET": {
        const row = table.rows.find((row) => row.id === n(1));
        if (args.length % 2 !== 0) throw new EraError("DT_ROW_SET expects table, id and column/value pairs");
        if (!row) return result(0n);
        this.assignCells(table, row, args, 2);
        return result(1n);
      }
      case "DT_TOXML": return { value: this.dataXml(table), schema: this.schemaXml(table) };
      case "DT_ROW_ADD": {
        if (args.length % 2 !== 1) throw new EraError("DT_ROW_ADD expects table followed by column/value pairs");
        const row: Row = { id: this.nextId, cells: new Map() };
        for (const [name, column] of table.columns) if (column.default !== undefined) row.cells.set(name, column.default);
        this.assignCells(table, row, args, 1);
        for (const [name, column] of table.columns) {
          if (name !== "id" && !column.nullable && !row.cells.has(name)) throw new EraError(`Data-table column cannot be null: ${name}`);
        }
        this.nextId++;
        table.rows.push(row);
        return result(row.id);
      }
      case "DT_SELECT": {
        const filter = args[1] === undefined ? "" : s(1).trim();
        const sort = args[2] === undefined ? "" : s(2).trim();
        const caseSensitive = table.caseSensitive ?? false;
        const reader = (row: Row) => (column: string): Cell => {
          if (column.toLowerCase() === "id") return row.id;
          if (!table.columns.has(column)) throw new EraError(`Unknown data-table column: ${column}`);
          return row.cells.get(column);
        };
        let rows = table.rows;
        if (filter) {
          const cacheKey = `${caseSensitive ? 1 : 0}${filter}`;
          let predicate = this.filters.get(cacheKey);
          if (!predicate) {
            if (this.filters.size > 2000) this.filters.clear();
            predicate = compileFilter(filter, caseSensitive);
            this.filters.set(cacheKey, predicate);
          }
          rows = rows.filter((row) => predicate!(reader(row)));
        }
        if (sort) {
          const rules = parseSort(sort);
          rows = rows === table.rows ? [...rows] : rows;
          rows.sort((a, b) => {
            for (const { column, descending } of rules) {
              const order = compareCells(reader(a)(column), reader(b)(column), caseSensitive);
              if (order) return descending ? -order : order;
            }
            return 0;
          });
        }
        const selected = rows.map((row) => row.id);
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

  private assignCells(table: Table, row: Row, args: (Value | undefined)[], start: number): void {
    for (let i = start; i < args.length; i += 2) {
      const name = text(args[i] ?? "");
      const column = table.columns.get(name);
      if (name.toLowerCase() === "id") throw new EraError("Cannot assign data-table id column");
      if (!column) throw new EraError(`Unknown data-table column: ${name}`);
      const value = this.convert(args[i + 1], column);
      if (value !== undefined) row.cells.set(name, value);
      else row.cells.delete(name);
    }
  }

  /** The XSD that .NET's DataTable.WriteXmlSchema emits for a standalone table. */
  private schemaXml(table: Table): string {
    const name = escape(table.name);
    const columns = [...table.columns].map(([column, { type, nullable, default: fallback }]) =>
      `              <xs:element name="${escape(column)}" type="${XSD_TYPES[type]}"${fallback === undefined ? "" : ` default="${escape(String(fallback))}"`}${nullable ? ` minOccurs="0"` : ""} />\r\n`).join("");
    return `<?xml version="1.0" encoding="utf-16"?>\r\n<xs:schema id="NewDataSet" xmlns="" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata">\r\n`
      + `  <xs:element name="NewDataSet" msdata:IsDataSet="true" msdata:MainDataTable="${name}" msdata:UseCurrentLocale="true">\r\n    <xs:complexType>\r\n      <xs:choice minOccurs="0" maxOccurs="unbounded">\r\n`
      + `        <xs:element name="${name}"${table.caseSensitive ? ' msdata:CaseSensitive="true"' : ""}>\r\n          <xs:complexType>\r\n            <xs:sequence>\r\n${columns}            </xs:sequence>\r\n          </xs:complexType>\r\n        </xs:element>\r\n`
      + `      </xs:choice>\r\n    </xs:complexType>\r\n  </xs:element>\r\n</xs:schema>`;
  }

  /** The XML that .NET's DataTable.WriteXml emits: one element per row, omitting null cells. */
  private dataXml(table: Table): string {
    const name = escape(table.name);
    const rows = table.rows.map((row) => `  <${name}>\r\n${[...table.columns.keys()].flatMap((column) => {
      const value = column === "id" ? row.id : row.cells.get(column);
      return value === undefined ? [] : [`    <${escape(column)}>${escape(String(value))}</${escape(column)}>\r\n`];
    }).join("")}  </${name}>\r\n`).join("");
    return `<?xml version="1.0" standalone="yes"?>\r\n<DocumentElement>\r\n${rows}</DocumentElement>`;
  }

  /** Reads a DataTable XSD and its rows; returns undefined when either document is unusable. */
  private fromXml(schemaSource: string, dataSource: string): Table | undefined {
    let schema, data;
    try { schema = parseXml(schemaSource); data = parseXml(dataSource); }
    catch (error) { if (error instanceof EraError) return undefined; throw error; }
    const XS = "http://www.w3.org/2001/XMLSchema";
    const elements = (parent: Element | Document, local: string): Element[] =>
      [...(parent.getElementsByTagNameNS(XS, local) as unknown as Iterable<Element>)];
    const root = elements(schema, "element").find((element) => element.getAttributeNS("urn:schemas-microsoft-com:xml-msdata", "IsDataSet") === "true");
    const main = root?.getAttributeNS("urn:schemas-microsoft-com:xml-msdata", "MainDataTable");
    const definition = (root ? elements(root, "element") : elements(schema, "element"))
      .find((element) => elements(element, "sequence").length && (!main || element.getAttribute("name") === main.replace(/_x([0-9A-F]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))));
    const sequence = definition && elements(definition, "sequence")[0];
    if (!definition || !sequence) return undefined;
    const table: Table = { name: definition.getAttribute("name")!, columns: new Map(), rows: [] };
    const sensitivity = definition.getAttributeNS("urn:schemas-microsoft-com:xml-msdata", "CaseSensitive") || root?.getAttributeNS("urn:schemas-microsoft-com:xml-msdata", "CaseSensitive");
    if (sensitivity) table.caseSensitive = sensitivity.toLowerCase() === "true";
    for (const element of elements(sequence, "element")) {
      const type = (Object.keys(XSD_TYPES) as Column["type"][]).find((type) => XSD_TYPES[type] === element.getAttribute("type"));
      const column = element.getAttribute("name");
      if (!type || !column) return undefined;
      const entry: Column = { type, nullable: element.getAttribute("minOccurs") === "0" };
      const fallback = element.getAttribute("default");
      if (fallback !== null && fallback !== "") entry.default = this.convert(type === "string" ? fallback : BigInt(fallback), entry);
      table.columns.set(column, entry);
    }
    if (!table.columns.has("id")) table.columns.set("id", { type: "int64", nullable: false });
    for (const element of [...(data.documentElement!.childNodes as unknown as Iterable<Element>)]) {
      if (element.nodeType !== 1 || element.nodeName !== table.name) continue;
      const row: Row = { id: this.nextId++, cells: new Map() };
      for (const [name, column] of table.columns) if (column.default !== undefined) row.cells.set(name, column.default);
      for (const cell of [...(element.childNodes as unknown as Iterable<Element>)]) {
        if (cell.nodeType !== 1) continue;
        const column = table.columns.get(cell.nodeName);
        if (!column) continue;
        const raw = cell.textContent ?? "";
        if (column.type !== "string" && !/^\s*[+-]?\d+\s*$/.test(raw)) return undefined;
        const value = this.convert(column.type === "string" ? raw : BigInt(raw.trim()), column)!;
        if (cell.nodeName === "id") row.id = integer(value);
        else row.cells.set(cell.nodeName, value);
      }
      for (const [name, column] of table.columns)
        if (name !== "id" && !column.nullable && !row.cells.has(name)) return undefined;
      table.rows.push(row);
    }
    for (const row of table.rows) if (row.id >= this.nextId) this.nextId = row.id + 1n;
    return table;
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
