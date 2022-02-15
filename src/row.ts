export type Row = {
	uuid?: string,
} & Record<string, string | number | (string | number)[]>;

export type RowOptions = Partial<Row>;
