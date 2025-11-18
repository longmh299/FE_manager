import React from "react";

const DashboardPage: React.FC = () => {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Tổng quan</h2>
      <p className="text-sm text-slate-600">
        Chọn chức năng ở menu bên trái để thao tác: linh kiện/máy móc, doanh
        thu, hóa đơn, khách hàng...
      </p>
    </div>
  );
};

export default DashboardPage;
