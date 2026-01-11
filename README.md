# Vibe of the Thing

A collection of interactive tools for exploring Australian federal government data.

## Tools

| Tool | Description | Key Features |
| - | - | - |
| **Budget Daisy** | Interactive circular/sunburst visualisation of Australian federal budgets and revenues, inspired by DaisyDisk | • Interactive sunburst chart with drill-down<br>• Year comparison & trend analysis<br>• Search & filter across categories<br>• Budget vs actual spending |
| **Parliament Kanban** | Kanban board view of all bills in the current parliament | • Visual bill tracking<br>• Status updates<br>• Legislative progress monitoring |
| **When Talk** | Estimate when speakers will get their turn in Federal Parliament debates | • Live debate tracking<br>• Speaker timeline visualisation<br>• Bill matching<br>• Shareable links |

### Data Sources

- [Parliamentary Budget Office Historical Fiscal Data](https://www.pbo.gov.au/publications-and-data/data-and-tools/data-portal/historical-fiscal-data)
- [Parliament of Australia](https://www.aph.gov.au)
- [Open Australia](https://openaustralia.org.au)

## Make Targets

| Target | Description |
| - | - |
| `make generate` | Generate data for Parliament Kanban and Budget Daisy from their respective sources |
| `make build` | Build and serve the Jekyll site locally at `http://0.0.0.0:8080/` |
| `make format` | Format code using isort, ruff, and eslint |
| `make clean` | Remove all generated files, caches, and dependencies |

## Technologies

- Jekyll for static site generation
- D3.js for data visualisation
- SCSS for styling
