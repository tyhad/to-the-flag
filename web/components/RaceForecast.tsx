import { teamColor } from "../theme/teams";
import { FORECAST_COLUMNS, type ForecastDisplay } from "../viewModel/raceForecast";

/**
 * What to expect in the next race, given the starting grid above: the chance to win, finish on the podium and in the
 * points, and the expected finish. A model estimate, said in the header, and the grid it is based on is named there.
 */
export function RaceForecast({ display }: { display: ForecastDisplay }) {
  if (display.kind === "none") return null;
  return (
    <section aria-label="Race forecast" className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="type-heading text-text">Race forecast</h3>
      <Body display={display} />
    </section>
  );
}

function Body({ display }: { display: Exclude<ForecastDisplay, { kind: "none" }> }) {
  if (display.kind === "calculating") {
    return (
      <p role="status" className="type-body text-text-2">
        Calculating the forecast…
      </p>
    );
  }

  if (display.kind === "failed") {
    return (
      <div role="alert" className="flex flex-col gap-1 rounded-control border border-line p-3">
        <p className="type-title text-red">The forecast could not be calculated</p>
        <p className="type-body text-text-2">{display.message}</p>
      </div>
    );
  }

  const { view, updating, failed } = display;
  return (
    <div className="flex flex-col gap-2">
      <p className="type-note text-text-2">{view.header}</p>
      {failed ? (
        <div role="alert" className="flex flex-col gap-1 rounded-control border border-line p-3">
          <p className="type-title text-red">The forecast could not be updated</p>
          <p className="type-body text-text-2">{failed}</p>
        </div>
      ) : null}
      <div aria-busy={updating} className={`flex flex-col gap-2 ${updating || failed ? "opacity-60" : ""}`}>
        {updating ? (
          <p role="status" className="type-note text-text-2">
            Updating…
          </p>
        ) : null}
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className="type-label pb-1 text-left text-text-2">
                Driver
              </th>
              {FORECAST_COLUMNS.map((column) => (
                <th key={column.key} scope="col" title={column.title} aria-label={column.title} className="type-label pb-1 text-right text-text-2">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.code} className="border-t border-line">
                <th
                  scope="row"
                  className="type-title py-1 pl-2 text-left text-text"
                  style={{ borderLeft: `3px solid ${row.teamId ? teamColor(row.teamId) : "transparent"}` }}
                >
                  {row.code}
                </th>
                <td className="type-data py-1 text-right text-text-2">{row.grid}</td>
                <td className="type-data py-1 text-right text-text">{row.win}</td>
                <td className="type-data py-1 text-right text-text">{row.podium}</td>
                <td className="type-data py-1 text-right text-text">{row.points}</td>
                <td className="type-data py-1 text-right text-text-2">{row.finish}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="type-note text-text-2">{view.note}</p>
    </div>
  );
}
