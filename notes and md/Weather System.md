## Weather

- Weather affects **XP only**, never gathering speed.
- Each day's effect is a whole number from **5% to 20%**:
  **`const effect = randomInt(5, 20);`**
- The roll is seeded by the UTC day number, so every player sees the same sky and the forecast never changes once revealed.
- Severity is determined by the effect:
  - **5% to 9%:** Faint
  - **10% to 15%:** Oppressive
  - **16% to 20%:** Extreme
- The weather is displayed using the severity as a prefix, for example:
  **Extreme Gloom: +18% Flaying, −18% Harvesting**
- Each weather has exactly **one favoured skill** and **one hindered skill**.

### Weather Relationships

| Weather | Favoured | Hindered |
|---|---|---|
| **Aridity** | Delving | Dredging |
| **Miasma** | Dredging | Felling |
| **Gale** | Felling | Flaying |
| **Gloom** | Flaying | Harvesting |
| **Frost** | Harvesting | Delving |

### Forecast

- A **7-day weather forecast** is revealed every **Sunday at 00:00**.
- This reveals the complete weather schedule for the upcoming week.
- Players therefore have the full week ahead visible before the next cycle begins.
- **Bountiful Weekend** remains a separate **+20% XP** bonus and does not affect weather severity.