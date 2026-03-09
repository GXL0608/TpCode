import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;

public class TaskFeedbackUpdate {
  private static String esc(String value) {
    return value
      .replace("\\", "\\\\")
      .replace("\"", "\\\"")
      .replace("\n", "\\n")
      .replace("\r", "\\r");
  }

  private static void out(String text) {
    System.out.println(text);
  }

  public static void main(String[] args) throws Exception {
    if (args.length < 4) {
      out("{\"ok\":false,\"code\":\"oracle_feedback_update_failed\",\"message\":\"Oracle回写失败：缺少JDBC参数\"}");
      return;
    }

    String host = args[0];
    String port = args[1];
    String sid = args[2];
    String timeout = args.length >= 5 ? args[3] : "120";
    String id = args.length >= 5 ? args[4] : args[3];
    String user = System.getenv("OPENCODE_TASK_FEEDBACK_ORACLE_USER");
    String password = System.getenv("OPENCODE_TASK_FEEDBACK_ORACLE_PASSWORD");

    if (user == null || user.trim().isEmpty() || password == null) {
      out("{\"ok\":false,\"code\":\"oracle_feedback_update_failed\",\"message\":\"Oracle回写失败：缺少JDBC认证信息\"}");
      return;
    }

    String url =
      "jdbc:oracle:thin:@(DESCRIPTION=(CONNECT_TIMEOUT=" + timeout + ")(TRANSPORT_CONNECT_TIMEOUT=" + timeout + ")(ADDRESS=(PROTOCOL=TCP)(HOST=" + host + ")(PORT=" + port + "))(CONNECT_DATA=(SID=" + sid + ")))";

    try (
      Connection conn = DriverManager.getConnection(url, user, password);
      PreparedStatement stmt = conn.prepareStatement("UPDATE TASK_FEEDBACK SET IS_AI_PLAN = ? WHERE TASK_FEEDBACK_ID = ?")
    ) {
      stmt.setInt(1, 1);
      stmt.setString(2, id);
      int rows = stmt.executeUpdate();
      if (rows == 1) {
        out("{\"ok\":true,\"rows\":1}");
        return;
      }
      if (rows == 0) {
        out("{\"ok\":false,\"code\":\"oracle_feedback_missing\",\"message\":\"Oracle回写失败：未找到 TASK_FEEDBACK_ID=" + esc(id) + " 对应的数据\",\"rows\":0}");
        return;
      }
      out("{\"ok\":false,\"code\":\"oracle_feedback_row_count_invalid\",\"message\":\"Oracle回写失败：更新了 " + rows + " 条 TASK_FEEDBACK 记录，期望 1 条\",\"rows\":" + rows + "}");
    } catch (Exception error) {
      out("{\"ok\":false,\"code\":\"oracle_feedback_update_failed\",\"message\":\"Oracle回写失败：" + esc(error.getMessage() == null ? error.toString() : error.getMessage()) + "\"}");
    }
  }
}
