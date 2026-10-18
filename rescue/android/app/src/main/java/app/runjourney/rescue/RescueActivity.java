package app.runjourney.rescue;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;

/** This screen performs no rescue or database IO until the explicit button press. */
public final class RescueActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(32, 48, 32, 32);
        TextView status = new TextView(this);
        status.setText("読み取り専用のデータ救出\n計測・保存再試行・データ移行は実行しません。\n開始操作までDBへアクセスしません。");
        Button start = new Button(this);
        start.setText("原本をコピーして救出を開始");
        layout.addView(status); layout.addView(start);
        ScrollView scroll = new ScrollView(this); scroll.addView(layout); setContentView(scroll);
        start.setOnClickListener(view -> {
            start.setEnabled(false);
            status.setText("救出中。元のDBは更新しません。");
            new Thread(() -> {
                try {
                    if (!getPackageName().equals("app.runjourney.mobile.test")) throw new IllegalStateException("Test専用です");
                    File output = getExternalFilesDir("read-only-rescue");
                    if (output == null) throw new IllegalStateException("救出先を利用できません");
                    File result = new RescueEngine().rescue(getDatabasePath("RKStorage"), output);
                    runOnUiThread(() -> status.setText("救出終了。manifest.jsonの状態を確認してください。\n" + result));
                } catch (Exception error) {
                    // Never fall back to AsyncStorage or recreate/delete a database.
                    runOnUiThread(() -> status.setText("救出を停止しました。元のDBは更新していません。\n" + error.getClass().getSimpleName() + ": " + error.getMessage()));
                }
            }, "read-only-rescue").start();
        });
    }
}
