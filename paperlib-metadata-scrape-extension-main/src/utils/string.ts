export function isEmpty(value: string) {
    return (
      value == null ||
      (typeof value === "string" && value.trim().length === 0) ||
      value === "undefined" ||
      value === "null"
    );
  }