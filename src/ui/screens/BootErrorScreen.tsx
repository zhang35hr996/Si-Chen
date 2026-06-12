/**
 * Content bugs are loud at dev time (skeleton-plan §10): list every collected
 * error with its file. The game does not start over broken content.
 */
import { formatErrorTag, type GameError } from "../../engine/infra/errors";

export function BootErrorScreen({ errors }: { errors: GameError[] }) {
  return (
    <main className="boot-error">
      <h1>内容校验失败</h1>
      <p>
        共 {errors.length} 处错误。修复 content/ 下的文件后刷新；也可运行{" "}
        <code>npm run validate-content</code>。
      </p>
      <ul>
        {errors.map((error, index) => (
          <li key={index}>
            <code>{formatErrorTag(error)}</code> {error.message}
          </li>
        ))}
      </ul>
    </main>
  );
}
