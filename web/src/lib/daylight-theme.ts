export function daylightTheme(hour = new Date().getHours()): "light" | "dark" {
    return hour >= 7 && hour < 19 ? "light" : "dark";
}
