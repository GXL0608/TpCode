namespace TPHY_HIS_System
{
    partial class XtraFormLogin
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            this.simpleButton1 = new DevExpress.XtraEditors.SimpleButton();
            this.simpleButton2 = new DevExpress.XtraEditors.SimpleButton();
            this.txt_id = new DevExpress.XtraEditors.TextEdit();
            this.txt_pwd = new DevExpress.XtraEditors.TextEdit();
            this.labelControl1 = new DevExpress.XtraEditors.LabelControl();
            this.labelControl_error = new DevExpress.XtraEditors.LabelControl();
            this.menuStrip1 = new System.Windows.Forms.MenuStrip();
            this.配置ToolStripMenuItem = new System.Windows.Forms.ToolStripMenuItem();
            this.更新日志ToolStripMenuItem = new System.Windows.Forms.ToolStripMenuItem();
            this.labYYMC = new DevExpress.XtraEditors.LabelControl();
            this.labDDBH = new DevExpress.XtraEditors.LabelControl();
            this.simpleButton3 = new DevExpress.XtraEditors.SimpleButton();
            this.cmb_UserName = new System.Windows.Forms.ComboBox();
            ((System.ComponentModel.ISupportInitialize)(this.txt_id.Properties)).BeginInit();
            ((System.ComponentModel.ISupportInitialize)(this.txt_pwd.Properties)).BeginInit();
            this.menuStrip1.SuspendLayout();
            this.SuspendLayout();
            // 
            // simpleButton1
            // 
            this.simpleButton1.Appearance.Options.UseTextOptions = true;
            this.simpleButton1.Appearance.TextOptions.WordWrap = DevExpress.Utils.WordWrap.Wrap;
            this.simpleButton1.Location = new System.Drawing.Point(417, 265);
            this.simpleButton1.Name = "simpleButton1";
            this.simpleButton1.Size = new System.Drawing.Size(75, 23);
            this.simpleButton1.TabIndex = 2;
            this.simpleButton1.Text = "密码登录";
            this.simpleButton1.Click += new System.EventHandler(this.simpleButton1_Click);
            // 
            // simpleButton2
            // 
            this.simpleButton2.Location = new System.Drawing.Point(511, 265);
            this.simpleButton2.Name = "simpleButton2";
            this.simpleButton2.Size = new System.Drawing.Size(75, 23);
            this.simpleButton2.TabIndex = 3;
            this.simpleButton2.Text = "退出";
            this.simpleButton2.Click += new System.EventHandler(this.simpleButton2_Click);
            // 
            // txt_id
            // 
            this.txt_id.EditValue = "";
            this.txt_id.Location = new System.Drawing.Point(395, 184);
            this.txt_id.Name = "txt_id";
            this.txt_id.Properties.BorderStyle = DevExpress.XtraEditors.Controls.BorderStyles.Office2003;
            this.txt_id.Size = new System.Drawing.Size(191, 20);
            this.txt_id.TabIndex = 0;
            this.txt_id.TextChanged += new System.EventHandler(this.txt_id_TextChanged);
            this.txt_id.PreviewKeyDown += new System.Windows.Forms.PreviewKeyDownEventHandler(this.txt_id_PreviewKeyDown);
            // 
            // txt_pwd
            // 
            this.txt_pwd.EditValue = "";
            this.txt_pwd.Location = new System.Drawing.Point(395, 210);
            this.txt_pwd.Name = "txt_pwd";
            this.txt_pwd.Properties.BorderStyle = DevExpress.XtraEditors.Controls.BorderStyles.Office2003;
            this.txt_pwd.Properties.PasswordChar = '*';
            this.txt_pwd.Size = new System.Drawing.Size(191, 20);
            this.txt_pwd.TabIndex = 1;
            this.txt_pwd.TextChanged += new System.EventHandler(this.txt_pwd_TextChanged);
            this.txt_pwd.PreviewKeyDown += new System.Windows.Forms.PreviewKeyDownEventHandler(this.txt_pwd_PreviewKeyDown);
            // 
            // labelControl1
            // 
            this.labelControl1.Location = new System.Drawing.Point(9, 314);
            this.labelControl1.Name = "labelControl1";
            this.labelControl1.Size = new System.Drawing.Size(124, 14);
            this.labelControl1.TabIndex = 3;
            this.labelControl1.Text = "Copyright 1996 - 2022";
            // 
            // labelControl_error
            // 
            this.labelControl_error.Appearance.Font = new System.Drawing.Font("Tahoma", 10F, System.Drawing.FontStyle.Bold);
            this.labelControl_error.Appearance.ForeColor = System.Drawing.Color.Red;
            this.labelControl_error.Location = new System.Drawing.Point(395, 313);
            this.labelControl_error.Name = "labelControl_error";
            this.labelControl_error.Size = new System.Drawing.Size(0, 16);
            this.labelControl_error.TabIndex = 4;
            // 
            // menuStrip1
            // 
            this.menuStrip1.Items.AddRange(new System.Windows.Forms.ToolStripItem[] {
            this.配置ToolStripMenuItem,
            this.更新日志ToolStripMenuItem});
            this.menuStrip1.Location = new System.Drawing.Point(0, 0);
            this.menuStrip1.Name = "menuStrip1";
            this.menuStrip1.Size = new System.Drawing.Size(648, 25);
            this.menuStrip1.TabIndex = 5;
            this.menuStrip1.Text = "menuStrip1";
            this.menuStrip1.Visible = false;
            // 
            // 配置ToolStripMenuItem
            // 
            this.配置ToolStripMenuItem.Name = "配置ToolStripMenuItem";
            this.配置ToolStripMenuItem.ShortcutKeys = System.Windows.Forms.Keys.F8;
            this.配置ToolStripMenuItem.Size = new System.Drawing.Size(44, 21);
            this.配置ToolStripMenuItem.Text = "配置";
            // 
            // 更新日志ToolStripMenuItem
            // 
            this.更新日志ToolStripMenuItem.Name = "更新日志ToolStripMenuItem";
            this.更新日志ToolStripMenuItem.ShortcutKeys = System.Windows.Forms.Keys.F9;
            this.更新日志ToolStripMenuItem.Size = new System.Drawing.Size(68, 21);
            this.更新日志ToolStripMenuItem.Text = "更新日志";
            // 
            // labYYMC
            // 
            this.labYYMC.Appearance.Font = new System.Drawing.Font("楷体", 25F, System.Drawing.FontStyle.Bold);
            this.labYYMC.Appearance.ForeColor = System.Drawing.Color.White;
            this.labYYMC.Location = new System.Drawing.Point(25, 22);
            this.labYYMC.Margin = new System.Windows.Forms.Padding(3, 2, 3, 2);
            this.labYYMC.Name = "labYYMC";
            this.labYYMC.Size = new System.Drawing.Size(245, 34);
            this.labYYMC.TabIndex = 74;
            this.labYYMC.Text = "沽源县人民医院";
            // 
            // labDDBH
            // 
            this.labDDBH.Appearance.Font = new System.Drawing.Font("楷体", 16F, System.Drawing.FontStyle.Bold);
            this.labDDBH.Appearance.ForeColor = System.Drawing.Color.White;
            this.labDDBH.Location = new System.Drawing.Point(74, 70);
            this.labDDBH.Margin = new System.Windows.Forms.Padding(3, 2, 3, 2);
            this.labDDBH.Name = "labDDBH";
            this.labDDBH.Size = new System.Drawing.Size(144, 21);
            this.labDDBH.TabIndex = 75;
            this.labDDBH.Text = "H13072400361";
            // 
            // simpleButton3
            // 
            this.simpleButton3.Appearance.Options.UseTextOptions = true;
            this.simpleButton3.Appearance.TextOptions.WordWrap = DevExpress.Utils.WordWrap.Wrap;
            this.simpleButton3.Location = new System.Drawing.Point(320, 265);
            this.simpleButton3.Name = "simpleButton3";
            this.simpleButton3.Size = new System.Drawing.Size(75, 23);
            this.simpleButton3.TabIndex = 76;
            this.simpleButton3.Text = "CA登录";
            this.simpleButton3.Visible = false;
            this.simpleButton3.Click += new System.EventHandler(this.simpleButton3_Click);
            // 
            // cmb_UserName
            // 
            this.cmb_UserName.FormattingEnabled = true;
            this.cmb_UserName.Location = new System.Drawing.Point(395, 156);
            this.cmb_UserName.Name = "cmb_UserName";
            this.cmb_UserName.Size = new System.Drawing.Size(191, 22);
            this.cmb_UserName.TabIndex = 80;
            this.cmb_UserName.Visible = false;
            // 
            // XtraFormLogin
            // 
            this.AutoScaleDimensions = new System.Drawing.SizeF(7F, 14F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.BackgroundImageLayoutStore = System.Windows.Forms.ImageLayout.Stretch;
            this.BackgroundImageStore = global::TPHY.UWin.HIS2Station.Properties.Resources.login;
            this.ClientSize = new System.Drawing.Size(648, 334);
            this.Controls.Add(this.cmb_UserName);
            this.Controls.Add(this.simpleButton3);
            this.Controls.Add(this.labDDBH);
            this.Controls.Add(this.labYYMC);
            this.Controls.Add(this.labelControl_error);
            this.Controls.Add(this.labelControl1);
            this.Controls.Add(this.simpleButton2);
            this.Controls.Add(this.simpleButton1);
            this.Controls.Add(this.txt_pwd);
            this.Controls.Add(this.txt_id);
            this.Controls.Add(this.menuStrip1);
            this.DoubleBuffered = true;
            this.FormBorderStyle = System.Windows.Forms.FormBorderStyle.None;
            this.MainMenuStrip = this.menuStrip1;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.Name = "XtraFormLogin";
            this.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
            this.Text = "HIS工作站V10.0";
            this.Load += new System.EventHandler(this.XtraFormLogin_Load);
            this.MouseDown += new System.Windows.Forms.MouseEventHandler(this.XtraFormLogin_MouseDown);
            this.MouseMove += new System.Windows.Forms.MouseEventHandler(this.XtraFormLogin_MouseMove);
            ((System.ComponentModel.ISupportInitialize)(this.txt_id.Properties)).EndInit();
            ((System.ComponentModel.ISupportInitialize)(this.txt_pwd.Properties)).EndInit();
            this.menuStrip1.ResumeLayout(false);
            this.menuStrip1.PerformLayout();
            this.ResumeLayout(false);
            this.PerformLayout();

        }

        #endregion

        private DevExpress.XtraEditors.SimpleButton simpleButton1;
        private DevExpress.XtraEditors.SimpleButton simpleButton2;
        private DevExpress.XtraEditors.TextEdit txt_id;
        private DevExpress.XtraEditors.TextEdit txt_pwd;
        private DevExpress.XtraEditors.LabelControl labelControl1;
        private DevExpress.XtraEditors.LabelControl labelControl_error;
        private System.Windows.Forms.MenuStrip menuStrip1;
        private System.Windows.Forms.ToolStripMenuItem 配置ToolStripMenuItem;
        private System.Windows.Forms.ToolStripMenuItem 更新日志ToolStripMenuItem;
        private DevExpress.XtraEditors.LabelControl labYYMC;
        private DevExpress.XtraEditors.LabelControl labDDBH;
        private DevExpress.XtraEditors.SimpleButton simpleButton3;
        private System.Windows.Forms.ComboBox cmb_UserName;
    }
}